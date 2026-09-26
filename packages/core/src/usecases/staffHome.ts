import { geoCellOf } from '../domain';
import type { MapsPort } from '../ports/maps';
import type { StaffHome } from '../ports/staff';

/**
 * 自宅住所のジオコーディングの結果。
 * - ok: 緯度経度を保存した
 * - not_found: 住所が見つからなかった
 * - failed: 地図APIの失敗(通信・認証・クォータ等)
 * - unavailable: 地図APIを使えない環境(SCHEDULE_PROVIDER=noop 等)
 * ok 以外でも住所は保存する(ルート計算のたびに住所をジオコーディングする。GAS版と同じ)。
 */
export type HomeGeocodeStatus = 'ok' | 'not_found' | 'failed' | 'unavailable';

export interface ResolvedStaffHome {
  home: StaffHome;
  /** 住所が空のときは null(ジオコーディングしない)。 */
  geocode: HomeGeocodeStatus | null;
}

/** 自宅住所を保存する形にする(ジオコーディングはトランザクションの外で呼ぶこと)。 */
export async function resolveStaffHome(
  maps: MapsPort | undefined,
  rawAddress: string | null,
): Promise<ResolvedStaffHome> {
  const address = rawAddress?.trim() || null;
  if (!address) return { home: { address: null, geo: null, geoCell: null }, geocode: null };
  const withoutGeo = { address, geo: null, geoCell: null };
  if (!maps) return { home: withoutGeo, geocode: 'unavailable' };
  try {
    const geo = await maps.geocode(address);
    if (!geo) return { home: withoutGeo, geocode: 'not_found' };
    return { home: { address, geo, geoCell: geoCellOf(geo) }, geocode: 'ok' };
  } catch {
    return { home: withoutGeo, geocode: 'failed' };
  }
}
