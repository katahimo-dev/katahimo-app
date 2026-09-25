/**
 * 生年月日('yyyy/MM/dd')から「（１歳２か月）」のような年齢の表示を作る(GAS版 calculateAge)。
 * 数字は全角(GAS版の利用者の要望どおり)。形が違う・空のときは空文字。
 */
export function calculateAge(dob: string | null | undefined, today: Date): string {
  if (!dob) return '';
  const parts = dob.split('/');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts.map((p) => Number.parseInt(p, 10)) as [number, number, number];
  const birth = new Date(y, m - 1, d);

  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  return `（${toFullWidthDigits(years)}歳${toFullWidthDigits(months)}か月）`;
}

export function toFullWidthDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0xfee0));
}
