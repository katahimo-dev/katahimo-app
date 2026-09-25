import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** 半開区間 [from, to) の検索範囲。 */
export interface InstantRange {
  from: Date;
  to: Date;
}

/**
 * `column && tstzrange(from, to, '[)')`(時間帯の重なり)の条件式。GiSTインデックスが効く形。
 *
 * Dateをsqlテンプレートへ直接渡すとpostgres-jsドライバ側でシリアライズに失敗することがあるため、
 * ISO 8601文字列にしてtimestamptzへキャストする。
 */
export function overlapsRange(column: AnyPgColumn, range: InstantRange): SQL {
  return sql`${column} && tstzrange(${range.from.toISOString()}::timestamptz, ${range.to.toISOString()}::timestamptz, '[)')`;
}
