import { newId } from '@katahimo/core/domain';
import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * 全テーブル共通の列と命名。命名は PostgreSQL の既定に合わせる(`<table>_pkey` / `<table>_<cols>_key` /
 * `<table>_<cols>_fkey` / `<table>_<cols>_idx` / `<table>_<col>_check` / `<table>_<cols>_excl`)。
 * 列名は snake_case(drizzle の casing)。
 */

const MAX_IDENTIFIER = 63;

/**
 * 制約・索引の名前。PostgreSQL は63バイトを超える名前を黙って切り詰める(衝突しうる)ため、長すぎる名前は
 * tenant_id を省いた形にし、それでも長ければ定義時にエラーにする。
 */
export function constraintName(table: string, columns: readonly string[], suffix: string): string {
  const name = `${table}_${columns.join('_')}_${suffix}`;
  if (Buffer.byteLength(name) <= MAX_IDENTIFIER) return name;
  // 長すぎる名前は、どの制約にも共通する tenant_id を省いた名前にする(それでも長ければ定義を見直す)
  const short = `${table}_${columns.filter((c) => c !== 'tenant_id').join('_')}_${suffix}`;
  if (Buffer.byteLength(short) > MAX_IDENTIFIER) throw new Error(`制約名が63バイトを超えます: ${name}`);
  return short;
}

/** 主キー。アプリが UUIDv7 を採番する(暗号化の AAD に行IDを含めるため INSERT 前に決める)。DB の既定値は予備。 */
export const idColumn = () =>
  uuid()
    .notNull()
    .$defaultFn(newId)
    .default(sql`gen_random_uuid()`);

export const tenantIdColumn = () => uuid().notNull();

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** 更新日時。トリガー set_updated_at() が UPDATE のたびに now() にする(アプリは書かない)。 */
export const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** 楽観的排他の版。UPDATE … SET row_version = row_version + 1 WHERE row_version = $期待値(0件なら競合)。 */
export const rowVersion = () => integer().notNull().default(1);

/** CHECK (col IN (...)) の式。 */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}
