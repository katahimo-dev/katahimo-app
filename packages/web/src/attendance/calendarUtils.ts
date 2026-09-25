import type { ScheduleEvent } from '../api';

/**
 * GAS版(gas-childcare-visit-app/index.html)の週間予定タブと同じ計算ロジック
 * (calYmd_/calGetWeekStart_/calTimeToMinutes_/calComputeHourRange_)を移植したもの。
 */
export const CAL_DOW = ['日', '月', '火', '水', '木', '金', '土'];

export const CAL_TYPE_STYLE: Record<string, string> = {
  'CUSTOMER APPOINTMENT': 'bg-blue-100 text-blue-800 border-blue-300',
  'OFFICE WORK': 'bg-gray-200 text-gray-700 border-gray-300',
};

// 通常の勤務時間帯(9〜20時)を仮の表示範囲とし、それを超える予定がある場合のみ広げる。
const CAL_DEFAULT_START_HOUR = 9;
const CAL_DEFAULT_END_HOUR = 20;

export function calYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function calGetWeekStart(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function calTimeToMinutes(hhmm: string | undefined): number | null {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function calComputeHourRange(events: ScheduleEvent[]): { startHour: number; endHour: number } {
  let startHour = CAL_DEFAULT_START_HOUR;
  let endHour = CAL_DEFAULT_END_HOUR;
  for (const e of events) {
    const s = calTimeToMinutes(e.start);
    const en = calTimeToMinutes(e.end);
    if (s !== null) startHour = Math.min(startHour, Math.floor(s / 60));
    if (en !== null) endHour = Math.max(endHour, Math.ceil(en / 60));
  }
  if (endHour <= startHour) endHour = startHour + 1;
  return { startHour, endHour };
}
