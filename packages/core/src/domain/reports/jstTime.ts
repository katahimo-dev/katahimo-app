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
 * 'yyyy/MM/dd HH:mm[:ss]' 形式(JST壁時計時刻)の文字列をDateに変換する。
 * 領収書日時(OCR抽出値・保存時刻フォールバック)のパース専用。形式が想定外の場合は
 * 現在時刻にフォールバックする(領収書登録そのものを失敗させないため)。
 */
export function parseJstTimestampString(value: string): Date {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return new Date();
  const [, year, month, day, hour, minute, second] = match;
  const utcMs =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second || '0'),
    ) -
    JST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}
