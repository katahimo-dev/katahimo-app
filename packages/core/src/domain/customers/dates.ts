/**
 * 顧客・子どもの日付の表記。DB は date('YYYY-MM-DD')、画面・GAS版は 'YYYY/M/D'(生年月日)・'YYYY/MM/DD'(住所2の期間)。
 */
const SLASH_DATE = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/;

/** 'YYYY/M/D' 等を 'YYYY-MM-DD' にする(実在しない日付・読めない値は null)。 */
export function toIsoDate(value: string | null | undefined): string | null {
  const match = SLASH_DATE.exec((value ?? '').trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → 'YYYY/M/D'(GAS版の生年月日の表記。normalizeDateStr と同じ)。 */
export function formatBirthDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}/${m}/${d}`;
}

/** 'YYYY-MM-DD' に日数を足す。 */
export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 都道府県(住所の先頭)。 */
export function extractPrefecture(address: string): string | null {
  return /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/.exec(address.trim())?.[1] ?? null;
}
