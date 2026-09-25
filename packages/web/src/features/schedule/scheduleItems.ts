import type { ScheduleAppointmentLightView, ScheduleAppointmentWithRouteView } from '@katahimo/shared';
import { currentLocationDirectionsUrl } from '../../lib/mapsUrl';

/**
 * 予定の1件を画面に出す形にしたもの。GAS版はルートなし(renderSchedule: title/start/end)と
 * ルートつき(renderScheduleWithRoute: customerName/startTime/endTime + 移動)で別々に
 * HTMLを組み立てていたが、見た目は同じなので1つの形にそろえてから描く。
 */
export interface ScheduleItem {
  eventType: string;
  /** 件名(お客様の名前)。空なら画面では「（名前なし）」 */
  name: string;
  start: string;
  end: string;
  address: string;
  /** カードの上に出す移動(「🏠 家から」または「🚗 次へ」) */
  legBefore: RouteLeg | null;
  /** カードの下に出す移動(「🏠 家へ」) */
  legAfter: RouteLeg | null;
}

export interface RouteLeg {
  /** 「🏠 家から」「🚗 次へ」「🏠 家へ」 */
  label: string;
  /** 「30分（12km）」。GAS版と同じく、分も距離も無いときは「（わかりませんでした）」 */
  detail: string;
  /** 🗺️ 道順を見る(サーバーが作った道順のURL。無ければ '') */
  directionsUrl: string;
  /** 📍 今いる場所から(目的地だけの道順のURL。作れなければ '') */
  currentLocationUrl: string;
}

type MinOrKm = number | string;

/**
 * 移動の1区間(GAS版 formatRouteLeg)。分も距離も無い区間は出さない(null)。
 * 0分・空文字は「無い」扱い(GAS版の真偽値の判定と同じ)。
 */
export function toRouteLeg(label: string, min: MinOrKm, km: MinOrKm, url: string): RouteLeg | null {
  if (!km && !min) return null;
  const detail = [min ? `${min}分` : '', km ? `（${km}km）` : ''].filter(Boolean).join('');
  return {
    label,
    detail: detail || '（わかりませんでした）',
    directionsUrl: url || '',
    currentLocationUrl: currentLocationDirectionsUrl(url),
  };
}

/** ルートなしの予定(GET /api/schedule)を画面の形にする。 */
export function itemsFromPlainSchedule(appointments: ScheduleAppointmentLightView[]): ScheduleItem[] {
  return appointments.map((app) => ({
    eventType: app.eventType,
    name: app.title,
    start: app.start,
    end: app.end,
    address: app.address,
    legBefore: null,
    legAfter: null,
  }));
}

/**
 * ルートつきの予定(GET /api/schedule/route)を画面の形にする。
 * 出勤(家から)・移動(次へ)・退勤(家へ)のどれを出すかは、並び順ではなくサーバーが実際に計算した
 * 値の有無で決める(事務作業に挟まれた訪問は、1件で出勤・退勤の両方を持つことがあるため。GAS版と同じ)。
 */
export function itemsFromRouteSchedule(appointments: ScheduleAppointmentWithRouteView[]): ScheduleItem[] {
  return appointments.map((app) => {
    const hasAttendanceLeg = Boolean(app.attendanceMin || app.attendanceKm || app.attendanceUrl);
    const legBefore = hasAttendanceLeg
      ? toRouteLeg('🏠 家から', app.attendanceMin, app.attendanceKm, app.attendanceUrl)
      : toRouteLeg('🚗 次へ', app.moveMin, app.moveKm, app.moveUrl);
    const hasLeavingLeg = Boolean(app.leavingMin || app.leavingKm || app.leavingUrl);
    const legAfter = hasLeavingLeg
      ? toRouteLeg('🏠 家へ', app.leavingMin, app.leavingKm, app.leavingUrl)
      : null;
    return {
      eventType: app.eventType,
      name: app.customerName,
      start: app.startTime,
      end: app.endTime,
      address: app.address,
      legBefore,
      legAfter,
    };
  });
}
