import type { LatLng, RouteLeg, TravelMode } from '../../ports/maps';
import { locationQueryFor } from './place';
import type { AppointmentLegPlan, LegSummary, PlannedLeg } from './routeLegs';
import { summarizeLeg, UNKNOWN_LEG } from './routeLegs';
import type { AppointmentLegs } from './scheduleView';

/**
 * 地図APIを呼ばずに区間の距離・所要時間を見積もる(SCHEDULE_PROVIDER=database 用。Google の設定が無い環境)。
 *
 * 2点の緯度経度の直線距離(大円距離)に道なりの係数を掛けて距離とし、移動手段ごとの平均の速さで所要時間にする。
 * 実際の道のりではないため、値は目安(画面の表示・出勤簿への反映の見本)にだけ使う。
 */

/** 直線距離から道なりの距離にする係数(市街地の道路の迂回の目安)。 */
export const ESTIMATED_ROAD_FACTOR = 1.3;

/** 移動手段ごとの平均の速さ(km/h。信号・乗り換え・待ち時間を含めた目安)。 */
export const ESTIMATED_SPEED_KMH: Readonly<Record<TravelMode, number>> = {
  car: 25,
  bicycle: 12,
  walk: 4.5,
  transit: 20,
};

const EARTH_RADIUS_METERS = 6_371_000;

/** 2点間の大円距離(メートル、haversine)。 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 区間の見積もり(地図APIの RouteLeg と同じ形。分・kmへの丸めは summarizeLeg が行う)。 */
export function estimateRouteLeg(origin: LatLng, destination: LatLng, travelMode: TravelMode): RouteLeg {
  const distanceMeters = haversineMeters(origin, destination) * ESTIMATED_ROAD_FACTOR;
  const metersPerSecond = (ESTIMATED_SPEED_KMH[travelMode] * 1000) / 3600;
  return { distanceMeters, durationSeconds: distanceMeters / metersPerSecond };
}

/**
 * 計画した区間を見積もった値にする。起点・終点のどちらかに使える緯度経度が無ければ(住所だけ・住所2の適用期間中で
 * ジオコーディングが要る場合を含む)算出不可('')。
 */
export function estimateLegSummary(
  leg: PlannedLeg | null,
  businessDate: string,
  travelMode: TravelMode,
): LegSummary {
  if (!leg) return UNKNOWN_LEG;
  const from = locationQueryFor(leg.from, businessDate);
  const to = locationQueryFor(leg.to, businessDate);
  if (from?.kind !== 'latLng' || to?.kind !== 'latLng') return UNKNOWN_LEG;
  return summarizeLeg(
    from.latLng,
    to.latLng,
    estimateRouteLeg(from.latLng, to.latLng, travelMode),
    travelMode,
  );
}

/** 予定1件の3種類の区間を見積もる(RouteCalculator.summarizePlan の地図APIを使わない版)。 */
export function estimatePlanLegs(
  plan: AppointmentLegPlan,
  businessDate: string,
  travelMode: TravelMode,
): AppointmentLegs {
  return {
    attendance: estimateLegSummary(plan.attendance, businessDate, travelMode),
    move: estimateLegSummary(plan.move, businessDate, travelMode),
    leaving: estimateLegSummary(plan.leaving, businessDate, travelMode),
  };
}
