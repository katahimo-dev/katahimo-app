import { normalizeStaffName } from '../staffName';
import type { Appointment } from './types';

/** 開始時刻の昇順(同時刻は元の順を保つ安定ソート。GAS版 Array.sort と同じ)。 */
export function sortByStart(appointments: Appointment[]): Appointment[] {
  return [...appointments].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * 指定スタッフが担当する予定を開始時刻順に返す。
 *
 * 移植元: RouteSearch.js groupEventsByStaff。担当者名(予約確定は説明欄の施設名、[イベント]は
 * ゲスト、それ以外はカレンダーの持ち主)とスタッフ名を、空白差異を無視して比較する。
 * GAS版はスタッフ台帳で最初に名前が一致したスタッフへ割り当てていたため、空白を除いて同名の
 * スタッフが複数いると2人目以降には予定が出なかった。ここでは同名の全員に出る。
 */
export function appointmentsForStaff(appointments: Appointment[], staffName: string): Appointment[] {
  const target = normalizeStaffName(staffName);
  return sortByStart(
    appointments.filter((a) => a.assigneeNames.some((name) => normalizeStaffName(name) === target)),
  );
}
