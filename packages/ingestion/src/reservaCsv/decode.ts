import iconv from 'iconv-lite';

/**
 * RESERVA(外部予約システム)がエクスポートする顧客CSVのバイト列を文字列にデコードする。
 *
 * 移植元: gas-childcare-visit-app/CsvImport.js の checkAndImportLatestCsv() が行っていた
 * 「UTF-16LE → Shift_JIS → UTF-8の順に試し、ヘッダーのキーワードが含まれていれば採用」という
 * エンコーディング自動判定と同じ考え方。判定できない場合はUTF-8として扱う(GAS版と同じ既定)。
 */
const CANDIDATE_ENCODINGS = ['utf16le', 'Shift_JIS', 'utf8'] as const;
const HEADER_MARKERS = ['顧客ID', 'Customer'];

export function decodeReservaCsv(buffer: Buffer): string {
  for (const encoding of CANDIDATE_ENCODINGS) {
    let text: string;
    try {
      text = iconv.decode(buffer, encoding);
    } catch {
      continue;
    }
    if (HEADER_MARKERS.some((marker) => text.includes(marker))) {
      return stripBom(text);
    }
  }
  return stripBom(iconv.decode(buffer, 'utf8'));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * タブ区切りかカンマ区切りかを、先頭行に含まれる出現数で判定する。
 * 移植元: updateDatabaseFromLinesV2() のデリミタ判定と同じロジック。
 */
export function detectDelimiter(text: string): ',' | '\t' {
  const firstLine = text.substring(0, text.indexOf('\n'));
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? '\t' : ',';
}
