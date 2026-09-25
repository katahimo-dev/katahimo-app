import { ENCRYPTION_PURPOSES } from '../domain/pii';
import { parseLatLng } from '../domain/schedule/place';
import type { Place, ScheduleCustomer } from '../domain/schedule/types';
import type { CryptoPort, EncryptionPurpose } from '../ports/crypto';
import { DEFAULT_TRAVEL_MODE } from '../ports/maps';
import type { CustomerRecord, CustomerRepositoryPort, EncryptedField } from '../ports/repositories';
import type {
  ScheduleDirectory,
  ScheduleDirectoryPort,
  ScheduleStaff,
  StaffRouteProfileRecord,
  StaffRouteProfileRepositoryPort,
} from '../ports/scheduleDirectory';

export interface ScheduleDirectoryDeps {
  customers: CustomerRepositoryPort;
  staffRouteProfiles: StaffRouteProfileRepositoryPort;
  crypto: CryptoPort;
}

/**
 * 予定計算のマスタ(顧客・スタッフ)をDBから読み、緯度経度を復号して返す。
 * GAS版は顧客をDriveの顧客CSV、スタッフをスタッフ台帳シートから読んでいた(RouteSearch.js
 * getCustomerDataFromCsv / getStaffDataFromSpreadsheet)。新アプリでは customers / staff テーブル。
 */
export function createScheduleDirectory(deps: ScheduleDirectoryDeps): ScheduleDirectoryPort {
  return {
    async load(tenantId: string): Promise<ScheduleDirectory> {
      const [customerRows, staffRows] = await Promise.all([
        deps.customers.listActive(tenantId),
        deps.staffRouteProfiles.listByTenant(tenantId),
      ]);
      const decryptLatLng = async (field: EncryptedField | null, purpose: EncryptionPurpose) =>
        field ? parseLatLng(await deps.crypto.decrypt(tenantId, field, purpose)) : null;

      const [customers, staff] = await Promise.all([
        Promise.all(
          customerRows.map(async (row) =>
            toScheduleCustomer(row, await decryptLatLng(row.latLng, ENCRYPTION_PURPOSES.customerLatLng)),
          ),
        ),
        Promise.all(
          staffRows.map(async (row) =>
            toScheduleStaff(row, await decryptLatLng(row.homeLatLng, ENCRYPTION_PURPOSES.staffHomeLatLng)),
          ),
        ),
      ]);
      return { customers, staff };
    },
  };
}

function toScheduleCustomer(row: CustomerRecord, latLng: Place['latLng']): ScheduleCustomer {
  const temporaryAddress =
    row.address2 && row.address2StartDate && row.address2EndDate
      ? { address: row.address2, startDate: row.address2StartDate, endDate: row.address2EndDate }
      : null;
  return {
    customerId: row.externalId ?? '',
    name: row.name,
    place: { address: row.addressDetail ?? '', latLng, temporaryAddress },
  };
}

function toScheduleStaff(row: StaffRouteProfileRecord, latLng: Place['latLng']): ScheduleStaff {
  return {
    id: row.id,
    name: row.name,
    home: { address: row.homeAddress ?? '', latLng },
    travelMode: row.travelMode ?? DEFAULT_TRAVEL_MODE,
    calendarId: row.calendarId,
  };
}
