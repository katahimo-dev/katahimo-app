/**
 * 生年月日文字列を `YYYY/M/D` 形式に正規化する。
 *
 * 移植元: gas-childcare-visit-app/CsvImport.js の normalizeDateStr()。
 * RESERVA(外部予約システム)からエクスポートされる顧客CSVの「世帯全員の情報」欄は
 * 自由記述で、和暦・西暦・元号略記など複数の日付表記が混在するため、実運用で磨かれた
 * このヒューリスティックをロジックそのまま移植する(書き直すと未知の入力パターンを
 * 取りこぼすリスクがあるため)。
 */
export function normalizeDateStr(dateStr: string): string {
  if (!dateStr) return '';

  // 末尾の「生」を除去
  const str = dateStr.replace(/生$/, '').trim();

  // 1. 8桁西暦: 19860921
  if (/^\d{8}$/.test(str)) {
    return `${str.substring(0, 4)}/${str.substring(4, 6)}/${str.substring(6, 8)}`;
  }

  // 2. 和暦(漢字表記、空白ゆらぎ許容): 昭和59年5月9日, 平成5年1月14日, 令和7年7月17日
  const eraMatch = str.match(
    /^(明治|大正|昭和|平成|令和)\s*([0-9元]+)\s*年\s*([0-9]+)\s*月\s*([0-9]+)\s*日?$/,
  );
  if (eraMatch) {
    const era = eraMatch[1];
    let year = eraMatch[2] === '元' ? 1 : Number.parseInt(eraMatch[2] ?? '', 10);
    const month = Number.parseInt(eraMatch[3] ?? '', 10);
    const day = Number.parseInt(eraMatch[4] ?? '', 10);

    if (era === '明治') year += 1867;
    else if (era === '大正') year += 1911;
    else if (era === '昭和') year += 1925;
    else if (era === '平成') year += 1988;
    else if (era === '令和') year += 2018;

    return `${year}/${month}/${day}`;
  }

  // 2b. 元号略記(アルファベット): H1.10.16, h5.12.29, r3.5.14, H4/8/5(大文字小文字を区別しない)
  const abbrevMatch = str.match(/^([MTSHRmtshr])(\d{1,2})[./](\d{1,2})[./](\d{1,2})$/i);
  if (abbrevMatch) {
    const era = (abbrevMatch[1] ?? '').toUpperCase();
    let year = Number.parseInt(abbrevMatch[2] ?? '', 10);
    const month = Number.parseInt(abbrevMatch[3] ?? '', 10);
    const day = Number.parseInt(abbrevMatch[4] ?? '', 10);

    if (era === 'M') year += 1867;
    else if (era === 'T') year += 1911;
    else if (era === 'S') year += 1925;
    else if (era === 'H') year += 1988;
    else if (era === 'R') year += 2018;

    return `${year}/${month}/${day}`;
  }

  // 2b2. 和暦(漢字+ドット区切り): 令和5.9.25, 平成5.1.14
  const kanjiDotMatch = str.match(/^(明治|大正|昭和|平成|令和)(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/);
  if (kanjiDotMatch) {
    const era = kanjiDotMatch[1];
    let year = Number.parseInt(kanjiDotMatch[2] ?? '', 10);
    const month = Number.parseInt(kanjiDotMatch[3] ?? '', 10);
    const day = Number.parseInt(kanjiDotMatch[4] ?? '', 10);

    if (era === '明治') year += 1867;
    else if (era === '大正') year += 1911;
    else if (era === '昭和') year += 1925;
    else if (era === '平成') year += 1988;
    else if (era === '令和') year += 2018;

    return `${year}/${month}/${day}`;
  }

  // 2c. 西暦+年月日表記: 1961年9月2日
  const westernMatch = str.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (westernMatch) {
    return `${westernMatch[1]}/${westernMatch[2]}/${westernMatch[3]}`;
  }

  // 3. 標準的な YYYY.MM.DD / YYYY-MM-DD 等。年月日・ドット・ハイフンを "/" に統一する
  return str.replace(/[年月.-]/g, '/').replace(/日/g, '');
}
