/**
 * 退職日の判定。退職日(retirement_date、JSTの業務日 'YYYY-MM-DD')の当日以降はログインできない
 * (GAS版Auth.js verifyLogin/checkSessionの `retireDate <= today` と同じ規則)。
 *
 * GAS版は `new Date(退職日)` と `today.setHours(0,0,0,0)` をスクリプトのタイムゾーン(JST)で
 * 比較していた。Node.jsで `new Date('YYYY-MM-DD')` を使うとUTC 0時として解釈され、JSTの0〜9時に
 * 判定が1日ずれるため、ここでは日付文字列同士をJSTの業務日として比較する。
 */

/** 指定時刻のJSTでの日付('YYYY-MM-DD')。暦日の計算は domain/calendarDate.ts に集約している。 */
export { jstBusinessDate } from '../calendarDate';

/** retirementDate('YYYY-MM-DD')が businessDate('YYYY-MM-DD')以前なら退職済み。 */
export function isRetiredOn(retirementDate: string | null, businessDate: string): boolean {
  return retirementDate !== null && retirementDate !== '' && retirementDate <= businessDate;
}

/**
 * スタッフ台帳(スプレッドシートのCSV書き出し等)に入っている退職日の表記を 'YYYY-MM-DD' に揃える。
 * 'yyyy/M/d'・'yyyy-MM-dd'・'yyyy年M月d日'(後ろに時刻が付いていてもよい)を受け付け、
 * 空欄・解釈できない値はnullを返す。
 */
export function normalizeRetirementDate(value: string): string | null {
  const match = /^\s*(\d{4})\s*[/\-年.]\s*(\d{1,2})\s*[/\-月.]\s*(\d{1,2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // 2月30日のような存在しない日付を弾く。
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}
