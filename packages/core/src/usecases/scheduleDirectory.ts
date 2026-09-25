import { ENCRYPTION_PURPOSES as P } from '../domain/pii';
import { parseLatLng } from '../domain/schedule/place';
import type { ScheduleCustomer } from '../domain/schedule/types';
import type { CachePort } from '../ports/cache';
import type { AuditLogPort, CryptoPort } from '../ports/crypto';
import type { CustomerAddressRecord } from '../ports/customers';
import { DEFAULT_TRAVEL_MODE } from '../ports/maps';
import type { ScheduleDirectory, ScheduleDirectoryPort, ScheduleStaff } from '../ports/scheduleDirectory';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import { DecryptSession } from './cipher';

export interface ScheduleDirectoryDeps {
  uow: UnitOfWorkPort;
  crypto: CryptoPort;
  audit?: AuditLogPort;
  /**
   * 読み込んだマスタのキャッシュ(テナント × 顧客データの版数)。顧客CSVを取り込むと版数が変わり、次の読み込みで
   * 作り直す。スタッフの変更は TTL(cacheTtlSeconds)の後に反映される。
   */
  cache?: CachePort;
  cacheTtlSeconds?: number;
}

const DEFAULT_CACHE_TTL_SECONDS = 5 * 60;

/**
 * 予定計算のマスタ(顧客・スタッフ)を DB から読み、緯度経度を復号して返す(GAS版は顧客CSVとスタッフ台帳を
 * 読んでいた)。1回の読み込みは1トランザクション、復号の監査は1件。
 */
export function createScheduleDirectory(deps: ScheduleDirectoryDeps): ScheduleDirectoryPort {
  const ttl = deps.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  const inflight = new Map<string, Promise<ScheduleDirectory>>();

  async function loadFresh(tenantId: string): Promise<ScheduleDirectory> {
    const loaded = await deps.uow.run(tenantId, async (r) => ({
      customers: await r.customers.listActiveSummaries(),
      addresses: await r.customerAddresses.listForActiveCustomers(),
      sources: await r.customerSourceRecords.mapExternalIds('reserva'),
      staff: await r.staff.listRouteProfiles(),
    }));
    const d = new DecryptSession(deps.crypto, tenantId);
    const externalIdOf = new Map<string, string>();
    for (const [externalId, link] of loaded.sources) externalIdOf.set(link.customerId, externalId);
    const addressesByCustomer = new Map<string, CustomerAddressRecord[]>();
    for (const a of loaded.addresses)
      addressesByCustomer.set(a.customerId, [...(addressesByCustomer.get(a.customerId) ?? []), a]);

    const customers: ScheduleCustomer[] = [];
    for (const c of loaded.customers) {
      const addresses = addressesByCustomer.get(c.id) ?? [];
      const home = addresses.find((a) => a.kind === 'home');
      const secondary = addresses.find((a) => a.kind === 'secondary');
      const latLng = home?.geoEnc
        ? parseLatLng(await d.decrypt(P.customerAddressGeo, home.id, home.geoEnc))
        : null;
      customers.push({
        customerId: externalIdOf.get(c.id) ?? '',
        name: c.displayName,
        place: {
          address: home?.addressLine ?? '',
          latLng,
          temporaryAddress:
            secondary?.valid.start && secondary.valid.end
              ? {
                  address: secondary.addressLine,
                  startDate: secondary.valid.start,
                  // valid は [開始, 終了の翌日)。GAS版の期間は終了日を含む
                  endDate: new Date(Date.parse(`${secondary.valid.end}T00:00:00Z`) - 86_400_000)
                    .toISOString()
                    .slice(0, 10),
                }
              : null,
        },
      });
    }
    const staff: ScheduleStaff[] = [];
    for (const s of loaded.staff) {
      const latLng = s.homeGeoEnc ? parseLatLng(await d.decrypt(P.staffHomeGeo, s.id, s.homeGeoEnc)) : null;
      staff.push({
        id: s.id,
        name: s.displayName,
        home: { address: s.homeAddress ?? '', latLng },
        travelMode: s.travelMode ?? DEFAULT_TRAVEL_MODE,
        calendarId: s.scheduleCalendarId,
      });
    }
    d.flush(deps.audit, 'schedule.directory');
    return { customers, staff };
  }

  return {
    async load(tenantId: string): Promise<ScheduleDirectory> {
      if (!deps.cache) return loadFresh(tenantId);
      const version = await deps.uow.run(tenantId, async (r) => (await r.settings.get()).customerDataVersion);
      const key = `schedule-directory:v1:${tenantId}:${version}`;
      const cached = await deps.cache.get<ScheduleDirectory>(key);
      if (cached) return cached;
      let pending = inflight.get(key);
      if (!pending) {
        pending = loadFresh(tenantId).then(async (directory) => {
          await deps.cache?.set(key, directory, ttl);
          return directory;
        });
        inflight.set(key, pending);
        pending.finally(() => inflight.delete(key)).catch(() => undefined);
      }
      return pending;
    },
  };
}
