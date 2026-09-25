import { firstDayOfMonth, formatMonthDay, lastDayOfMonth, yearMonthOf } from '../calendarDate';

/**
 * 出勤簿の月ロック: 手入力で修正できるのは「今日(JST)が属する月」の日付だけ。
 * 前月以前は確定済み(給与計算に回っている)、来月以降はまだ修正できない。
 * 管理者も含め全員に同じ制限が掛かる。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の updatePastSchedule / getPastScheduleForDate。
 * カレンダーからの反映(calendarSync.ts)にはこの制限は掛からない(GAS版と同じ)。
 */

export interface EditableRange {
  /** 当月1日 'YYYY-MM-DD' */
  from: string;
  /** 当月末日 'YYYY-MM-DD' */
  to: string;
}

export type AttendanceEditCheck =
  | { editable: true }
  | { editable: false; reason: 'before_current_month' | 'after_current_month'; message: string };

export function editableRangeFor(today: string): EditableRange {
  const yearMonth = yearMonthOf(today);
  return { from: firstDayOfMonth(yearMonth), to: lastDayOfMonth(yearMonth) };
}

export function isWithinEditableRange(date: string, range: EditableRange): boolean {
  return date >= range.from && date <= range.to;
}

/** 修正できない場合の理由とメッセージ(文言はGAS版と同じ)。 */
export function checkAttendanceEditable(date: string, today: string): AttendanceEditCheck {
  const range = editableRangeFor(today);
  if (date < range.from) {
    return {
      editable: false,
      reason: 'before_current_month',
      message: `修正期限切れです。当月(${formatMonthDay(range.from)})より前の記録は変更できません。`,
    };
  }
  if (date > range.to) {
    return {
      editable: false,
      reason: 'after_current_month',
      message: `修正できません。来月以降(${formatMonthDay(range.to)}より後)の記録はまだ修正できません。`,
    };
  }
  return { editable: true };
}
