import { ymdParts } from '../../../lib/date';

/**
 * 生年月日('yyyy/MM/dd')から「（１歳２か月）」のような年齢の表示を作る(GAS版 calculateAge)。
 * 数字は全角(GAS版の利用者の要望どおり)。形が違う・空のときは空文字。today は業務日 'YYYY-MM-DD'(JST)。
 */
export function calculateAge(dob: string | null | undefined, today: string): string {
  if (!dob) return '';
  const parts = dob.split('/');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts.map((p) => Number.parseInt(p, 10)) as [number, number, number];
  // 2月30日のような日付はGAS版(new Date)と同じく次の月に繰り越してから数える
  const birth = new Date(Date.UTC(y, m - 1, d));
  const now = ymdParts(today);

  let years = now.year - birth.getUTCFullYear();
  let months = now.month - 1 - birth.getUTCMonth();
  if (now.day < birth.getUTCDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  return `（${toFullWidthDigits(years)}歳${toFullWidthDigits(months)}か月）`;
}

export function toFullWidthDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0xfee0));
}
