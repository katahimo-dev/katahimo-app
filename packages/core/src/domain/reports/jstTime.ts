const JST_OFFSET_MINUTES = 9 * 60;

/**
 * 'YYYY-MM-DD'の日付と'HH:mm'の時刻(JST・24時間表記)を、対応する絶対時刻(UTC基準のDate)に変換する。
 * GAS版saveReportの `new Date(`${datePart} ${timePart}`)` はサーバーのローカルタイムゾーンで解釈されるため
 * 環境依存だったが、こちらはJSTの壁時計時刻であることを明示して変換する。
 */
export function parseJstDateTime(dateStr: string, timeStr: string | undefined): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = (timeStr || '00:00').split(':').map(Number);
  const utcMs =
    Date.UTC(year || 1970, (month || 1) - 1, day || 1, hour || 0, minute || 0) - JST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}

/** Date を GAS版 Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss") と同じ書式の文字列にする。 */
export function formatJstDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** GAS版getCustomerReportsのfmt()と同じ 'yyyy/MM/dd HH:mm' 書式。 */
export function formatJstDateTimeShort(date: Date): string {
  return formatJstDateTime(date).slice(0, -3);
}

export function formatJstDateOnly(date: Date): string {
  return formatJstDateTime(date).split(' ')[0] ?? '';
}

/**
 * 領収書日時の表記(JST の壁時計時刻)。GAS版はOCRの結果の文字列をそのままシートの日時の列に書き、スプレッドシートが
 * 日時として解釈していたため、1桁の月・日・時('2026/9/5 9:05')や日付だけ('2026/09/05'、0:00 とみなす)、
 * 区切りの '-'・'.'・'年月日' も受け付ける。
 */
const RECEIPT_TIMESTAMP_PATTERN =
  /^(\d{4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?(?:(?:[ T]+|(?<=日))(\d{1,2})[:時](\d{1,2})分?(?::(\d{1,2}))?)?$/;

/**
 * 領収書日時の文字列を Date にする(JST の壁時計時刻として解釈する)。読めない表記・存在しない日時は null
 * (呼び出し側が GAS版と同じく報告の日付+開始時刻・登録時刻にフォールバックする)。
 */
export function parseJstTimestamp(value: string | null | undefined): Date | null {
  const match = RECEIPT_TIMESTAMP_PATTERN.exec((value ?? '').trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((v) => Number(v ?? '0')) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > 23 || minute > 59 || second > 59) return null;
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day)
    return null;
  return new Date(wall.getTime() - JST_OFFSET_MINUTES * 60_000);
}
