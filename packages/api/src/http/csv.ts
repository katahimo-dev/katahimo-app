import { writeStructuredLog } from './requestLog';

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

/** 書き出しが途中で失敗したときの最後の行(ここまでの行だけが入っている)。 */
export function exportFailedMarker(requestId: string | null): string {
  return `※ 書き出しが途中で失敗しました(request id ${requestId ?? '-'})。もう一度ダウンロードしてください`;
}

/** CSV を書く先(hono の StreamingApi のうち使う部分)。 */
export interface CsvSink {
  readonly aborted: boolean;
  write(chunk: string): Promise<unknown>;
}

/**
 * CSV を書く(BOM・見出し・まとまりごとの行)。受け取る側が切ったら読むのをやめる。途中で失敗したら
 * (見出しは送った後なので状態コードは変えられない)ERROR を残し、最後の行に失敗の印を書く。
 */
export async function writeCsvStream<T>(
  out: CsvSink,
  header: readonly string[],
  batches: AsyncIterable<T[]>,
  toLine: (item: T) => string,
  options: { requestId: string | null; failureMessage: string },
): Promise<void> {
  await out.write(UTF8_BOM + csvLine(header));
  try {
    for await (const batch of batches) {
      if (out.aborted) return;
      await out.write(batch.map(toLine).join(''));
    }
  } catch (error) {
    writeStructuredLog({
      severity: 'ERROR',
      message: options.failureMessage,
      requestId: options.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!out.aborted) await out.write(csvLine([exportFailedMarker(options.requestId)]));
  }
}
