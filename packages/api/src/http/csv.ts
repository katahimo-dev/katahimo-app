/** CSV の1行(RFC 4180。区切り文字・引用符・改行を含む値は引用符で囲む。改行は CRLF)。 */
export function csvLine(values: readonly string[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

/**
 * CSV の1項目。表計算ソフトが式として実行しないよう、=・+・-・@・タブ・復帰で始まる値は先頭に ' を付ける
 * (CSV インジェクション対策)。
 */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Excel が UTF-8 と判断するための BOM。 */
export const UTF8_BOM = '﻿';
