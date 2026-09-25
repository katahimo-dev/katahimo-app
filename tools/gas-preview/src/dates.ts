/** 'YYYY-MM-DD' の日付計算(時差の影響を受けないようUTCで計算する)。 */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0=日曜 … 6=土曜 */
export function dayOfWeek(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

export function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 撮影で固定する「今日」(Playwright の clock でブラウザの時計もこの日時にする)。 */
export const DEFAULT_TODAY = '2026-09-25';
export const DEFAULT_NOW_ISO = `${DEFAULT_TODAY}T10:00:00+09:00`;
