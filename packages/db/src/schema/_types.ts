import { customType } from 'drizzle-orm/pg-core';

/**
 * 時間帯(PostgreSQLの`tstzrange`)。境界は常に半開区間 `[start, end)` で書き込む
 * (10:00-12:00 と 12:00-14:00 が「重ならない」と判定されるようにするため)。
 *
 * Drizzle(0.38)は範囲型をネイティブに扱えないため customType で定義する。GiSTインデックス・
 * EXCLUDE制約(二重予約防止)・`&&`(重なり)演算子はこの型に対してDB側で機能する。
 * 読み出し時にDBが返す無限大の境界(`[x,)`や`infinity`)は null として表す。
 */
export interface TimeRange {
  start: Date | null;
  end: Date | null;
}

/** 書き込み用の`[start,end)`リテラル。nullの境界は無限大として空欄にする。 */
export function formatTstzRange(range: TimeRange): string {
  const s = range.start ? range.start.toISOString() : '';
  const e = range.end ? range.end.toISOString() : '';
  return `[${s},${e})`;
}

function parseBound(raw: string): Date | null {
  const v = raw.trim().replace(/^"|"$/g, '');
  if (v === '' || v === 'infinity' || v === '-infinity') return null;
  // PostgreSQLの出力形式 "2026-01-01 10:00:00+09" をISO 8601に寄せてからDateにする
  let iso = v.replace(' ', 'T');
  if (/[+-]\d\d$/.test(iso)) iso += ':00';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`tstzrangeの境界を解釈できません: ${raw}`);
  return d;
}

/** DBが返す`tstzrange`のテキスト表現を解釈する。空範囲('empty')はエラーにする。 */
export function parseTstzRange(value: string): TimeRange {
  const text = value.trim();
  if (text === 'empty') throw new Error('空のtstzrangeは扱えません');
  const inner = text.slice(1, -1);
  const comma = inner.indexOf(',', inner.startsWith('"') ? inner.indexOf('"', 1) : 0);
  if (comma < 0) throw new Error(`tstzrangeを解釈できません: ${value}`);
  return { start: parseBound(inner.slice(0, comma)), end: parseBound(inner.slice(comma + 1)) };
}

export const tstzrange = customType<{ data: TimeRange; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
  toDriver(value) {
    return formatTstzRange(value);
  },
  fromDriver(value) {
    return parseTstzRange(value);
  },
});
