import { formatJstDateTime } from './jstTime';

export interface ReceiptFallbackTimestampInput {
  /** クライアントが組み立てた 'yyyy/MM/dd HH:mm[:ss]'(GAS版buildReceiptTimestampの値)。 */
  receiptTimestamp?: string;
  /** 日報の訪問日 'YYYY-MM-DD'。 */
  reportDate?: string;
  /** 日報の開始時刻 'HH:mm'。 */
  startTime?: string;
}

/**
 * 画像ごとの領収書日時(OCR結果)が無い場合に使うフォールバック日時('yyyy/MM/dd HH:mm:ss'、JST)。
 * GAS版はクライアントのbuildReceiptTimestamp(日報の訪問日+開始時刻、秒は00)を送り、
 * 無ければサーバーの現在時刻を使っていた。ここでは
 * receiptTimestamp → reportDate+startTime → 現在時刻 の順に決める。
 */
export function resolveReceiptFallbackTimestamp(input: ReceiptFallbackTimestampInput, now: Date): string {
  const explicit = input.receiptTimestamp?.trim();
  if (explicit) return explicit;
  if (input.reportDate) {
    return `${input.reportDate.replaceAll('-', '/')} ${input.startTime || '00:00'}:00`;
  }
  return formatJstDateTime(now);
}
