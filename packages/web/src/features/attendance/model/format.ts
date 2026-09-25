/**
 * 数字の見せ方(GAS版 formatMinutesJa_ / formatKmJa_)。表示だけの変換で、保存する値は変えない。
 */

type NumberLike = number | string | null | undefined;

/** 分 → 「7時間30分」。0 → 「0分」、60 → 「1時間」、数値でない・負 → 「—」 */
export function formatMinutesJa(min: NumberLike): string {
  if (min === null || min === undefined || min === '') return '—';
  const n = Number(min);
  if (!Number.isFinite(n) || n < 0) return '—';
  const m = Math.round(n);
  if (m === 0) return '0分';
  const h = Math.floor(m / 60);
  const mi = m % 60;
  if (h === 0) return `${mi}分`;
  if (mi === 0) return `${h}時間`;
  return `${h}時間${mi}分`;
}

/** km → 「12.3km」(小数2桁まで)。数値でない → 「—」 */
export function formatKmJa(km: NumberLike): string {
  if (km === null || km === undefined || km === '') return '—';
  const n = Number(km);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100) / 100}km`;
}

/** 円の3桁区切り(GAS版 Number#toLocaleString()) */
export function formatYen(amount: number): string {
  return `${Number(amount).toLocaleString()}円`;
}
