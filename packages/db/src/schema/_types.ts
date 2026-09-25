import { customType } from 'drizzle-orm/pg-core';

/**
 * Drizzle(0.45)がネイティブに持たない PostgreSQL の型。
 * 範囲型は常に半開区間 `[開始, 終了)` で書き込む(10:00-12:00 と 12:00-14:00 は「重ならない」)。
 * 読み出し時の無限大の境界(`[x,)` 等)は null で表す。
 */

/** 暗号文・ハッシュ(*_enc・*_hash・*_bidx)。postgres.js は Buffer で返す。 */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

export interface TimeRange {
  start: Date | null;
  end: Date | null;
}

/** 日付の範囲。start は含み end は含まない(`[start, end)`)。null は無限。値は 'YYYY-MM-DD'。 */
export interface DateRange {
  start: string | null;
  end: string | null;
}

export function formatTstzRange(range: TimeRange): string {
  const s = range.start ? range.start.toISOString() : '';
  const e = range.end ? range.end.toISOString() : '';
  return `[${s},${e})`;
}

export function formatDateRange(range: DateRange): string {
  return `[${range.start ?? ''},${range.end ?? ''})`;
}

function splitRange(value: string, kind: string): [string, string] | null {
  const text = value.trim();
  if (text === 'empty') return null;
  const inner = text.slice(1, -1);
  const quoted = inner.startsWith('"');
  const comma = inner.indexOf(',', quoted ? inner.indexOf('"', 1) : 0);
  if (comma < 0) throw new Error(`${kind}を解釈できません: ${value}`);
  const unquote = (raw: string) => raw.trim().replace(/^"|"$/g, '');
  return [unquote(inner.slice(0, comma)), unquote(inner.slice(comma + 1))];
}

function parseInstant(raw: string): Date | null {
  if (raw === '' || raw === 'infinity' || raw === '-infinity') return null;
  // PostgreSQL の出力 "2026-01-01 10:00:00+09" を ISO 8601 に寄せる
  let iso = raw.replace(' ', 'T');
  if (/[+-]\d\d$/.test(iso)) iso += ':00';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`tstzrangeの境界を解釈できません: ${raw}`);
  return d;
}

export function parseTstzRange(value: string): TimeRange {
  const parts = splitRange(value, 'tstzrange');
  if (!parts) throw new Error('空のtstzrangeは扱えません');
  return { start: parseInstant(parts[0]), end: parseInstant(parts[1]) };
}

/** daterange は PostgreSQL が常に `[a,b)` に正規化して返す。 */
export function parseDateRange(value: string): DateRange {
  const parts = splitRange(value, 'daterange');
  if (!parts) throw new Error('空のdaterangeは扱えません');
  const bound = (raw: string) => (raw === '' || raw.endsWith('infinity') ? null : raw);
  return { start: bound(parts[0]), end: bound(parts[1]) };
}

export const tstzrange = customType<{ data: TimeRange; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
  toDriver: formatTstzRange,
  fromDriver: parseTstzRange,
});

export const daterange = customType<{ data: DateRange; driverData: string }>({
  dataType() {
    return 'daterange';
  },
  toDriver: formatDateRange,
  fromDriver: parseDateRange,
});
