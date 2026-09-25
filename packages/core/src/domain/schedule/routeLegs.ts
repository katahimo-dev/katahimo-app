import type { LatLng, RouteLeg, TravelMode } from '../../ports/maps';
import { hasLocation } from './place';
import type { Appointment, Place } from './types';

/** 経路を計算する1区間(起点→終点)。 */
export interface PlannedLeg {
  from: Place;
  to: Place;
}

/** 予定1件と、それに付く3種類の区間。不要な区間はnull。 */
export interface AppointmentLegPlan {
  appointment: Appointment;
  /** 出勤経路(自宅→その日最初の位置情報ありの予定)。 */
  attendance: PlannedLeg | null;
  /** 移動経路(直前の位置情報ありの予定→この予定)。 */
  move: PlannedLeg | null;
  /** 退勤経路(その日最後の位置情報ありの予定→自宅)。 */
  leaving: PlannedLeg | null;
}

/**
 * どの予定にどの区間の経路を付けるかを決める(地図APIは呼ばない)。
 *
 * 移植元: RouteSearch.js calculateDetailedRoutes。appointmentsは開始時刻順であること。
 * 位置情報の無い予定(オンライン相談・場所未入力の事務等)は飛ばして、前後の位置情報ありの予定を
 * つなぐ。位置情報の無い予定自体には、住所文字列がある場合(空白のみの住所等)に限り
 * 直前の位置情報ありの予定からの移動経路を付ける(GAS版の分岐をそのまま残している)。
 */
export function planRouteLegs(appointments: Appointment[], home: Place): AppointmentLegPlan[] {
  const located = appointments.filter((a) => hasLocation(a.place));
  const first = located[0];
  const last = located[located.length - 1];

  return appointments.map((appointment, index) => {
    const plan: AppointmentLegPlan = { appointment, attendance: null, move: null, leaving: null };
    const locatedIndex = located.indexOf(appointment);

    if (locatedIndex >= 0) {
      if (appointment === first) plan.attendance = { from: home, to: appointment.place };
      const previous = located[locatedIndex - 1];
      if (previous) plan.move = { from: previous.place, to: appointment.place };
      if (appointment === last) plan.leaving = { from: appointment.place, to: home };
      return plan;
    }

    const previous = appointments
      .slice(0, index)
      .reverse()
      .find((a) => hasLocation(a.place));
    if (previous && appointment.place.address) plan.move = { from: previous.place, to: appointment.place };
    return plan;
  });
}

/** 算出済みの区間。算出できなかった区間は url/min/km すべて ''(GAS版の空欄と同じ)。 */
export interface LegSummary {
  url: string;
  min: number | '';
  km: string;
}

export const UNKNOWN_LEG: LegSummary = { url: '', min: '', km: '' };

const MAPS_URL_TRAVEL_MODE: Record<TravelMode, string> = {
  car: 'driving',
  bicycle: 'bicycling',
  transit: 'transit',
  walk: 'walking',
};

/**
 * 地図APIの結果を画面・出勤簿用の値にする(移植元: RouteSearch.js getRouteDetails)。
 * 所要時間は分に四捨五入、距離はkmで小数2桁の文字列(出勤簿の距離セル・手当判定がこの丸めに依存する)。
 */
export function summarizeLeg(
  origin: LatLng,
  destination: LatLng,
  leg: RouteLeg,
  travelMode: TravelMode,
): LegSummary {
  const url =
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${origin.lat},${origin.lng}` +
    `&destination=${destination.lat},${destination.lng}` +
    `&travelmode=${MAPS_URL_TRAVEL_MODE[travelMode]}`;
  return {
    url,
    min: Math.round(leg.durationSeconds / 60),
    km: (leg.distanceMeters / 1000).toFixed(2),
  };
}
