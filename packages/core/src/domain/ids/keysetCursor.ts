/**
 * 一覧の続きの位置(keyset ページングの不透明な文字列)の検証。中身は `[時刻, ID]` の JSON を base64url にしたもの。
 * 利用者が書き換えられるため、DB の `::timestamptz` / `::uuid` に渡す前に形を確かめる(形の誤りで 500 にしない)。
 */

/** UUID(版・変種を問わない 8-4-4-4-12 桁の16進数)。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * 続きの位置の時刻の形: ISO 8601(`2026-09-25T01:02:03.456Z`)と PostgreSQL の timestamptz の文字列
 * (`2026-09-25 10:02:03.456789+09`)。時差は必ず付ける。
 */
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * 続きの位置に入りうる年の範囲。サーバーが作る続きの位置は DB の値の toISOString()(4桁の年は 0000〜9999)で、
 * 記録の日時は書き込むときに 2000〜2100年に絞っているが、それ以前に入った値・取込の値でも続きのページを読めるよう、
 * ここでは PostgreSQL の timestamptz が受け付ける4桁の年(0001〜9999。0000 は範囲外のエラーになる)を全て通す。
 */
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

/** 続きの位置の時刻の文字列を確かめて Date にする(形・範囲の誤りは null)。 */
export function parseCursorTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const at = new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(at.getTime())) return null;
  // 2月30日等の存在しない日は Date が翌月に繰り上げるため、書かれた年月日がその月にあるかを確かめる
  // (Date.UTC は 0〜99年を 1900年代にするため setUTCFullYear で作る)
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  if (probe.getUTCMonth() !== month - 1) return null;
  return at;
}

/** 続きの位置の中身(時刻の文字列はそのまま返す。DB の値をマイクロ秒まで保つ一覧があるため)。 */
export interface KeysetCursorPosition {
  at: Date;
  atText: string;
  id: string;
}

/** `[時刻, ID]` の続きの位置を読む。形の誤り(壊れた base64・JSON、UUID でない ID、範囲外の時刻)は null。 */
export function decodeKeysetCursor(cursor: string): KeysetCursorPosition | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) return null;
  const [atText, id] = decoded as [unknown, unknown];
  const at = parseCursorTimestamp(atText);
  if (!at || !isUuid(id)) return null;
  return { at, atText: atText as string, id };
}
