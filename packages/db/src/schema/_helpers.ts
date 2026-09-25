import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, foreignKey, pgPolicy, primaryKey } from 'drizzle-orm/pg-core';
import { constraintName } from './_columns';
import { tenants } from './platform';

/** テナントスコープのテーブルの制約(主キー・テナントへのFK・複合FK・RLSポリシー)。 */

/** 行の見える範囲をセッションのテナント(app_current_tenant())に限るポリシー(FORCE RLS と合わせて使う)。 */
export const TENANT_MATCHES: SQL = sql`tenant_id = app_current_tenant()`;

export const tenantIsolation = () =>
  pgPolicy('tenant_isolation', { as: 'permissive', for: 'all', using: TENANT_MATCHES, withCheck: TENANT_MATCHES });

/** (tenant_id, id) の主キー。 */
export function tenantPk(table: string, t: { tenantId: AnyPgColumn; id: AnyPgColumn }) {
  return primaryKey({ name: `${table}_pkey`, columns: [t.tenantId, t.id] });
}

/** tenant_id → platform.tenants(id)。テナントの削除(解約後の消去)で全データを消す。 */
export function tenantFk(table: string, t: { tenantId: AnyPgColumn }) {
  return foreignKey({
    name: constraintName(table, ['tenant_id'], 'fkey'),
    columns: [t.tenantId],
    foreignColumns: [tenants.id],
  }).onDelete('cascade');
}

type Target = { tenantId: AnyPgColumn; id: AnyPgColumn };

/**
 * テナント内の参照(`(tenant_id, x_id) → 親(tenant_id, id)`)。FK の検査は RLS を通らないため、単一列の
 * FK では別テナントの行を指せてしまう。複合FKで「同じテナントの行」をDBが保証する。
 * 所有される子(住所・連絡先・子ども等)は cascade、記録 → 人は no action(記録を残したまま人を消さない)。
 */
export function tenantRef(
  table: string,
  column: string,
  t: { tenantId: AnyPgColumn },
  local: AnyPgColumn,
  target: Target,
  onDelete: 'cascade' | 'no action' = 'no action',
) {
  return foreignKey({
    name: constraintName(table, ['tenant_id', column], 'fkey'),
    columns: [t.tenantId, local],
    foreignColumns: [target.tenantId, target.id],
  }).onDelete(onDelete);
}

/** テナントスコープの標準の制約一式(主キー・テナントへのFK・RLSポリシー)。 */
export function tenantScoped(table: string, t: { tenantId: AnyPgColumn; id: AnyPgColumn }) {
  return [tenantPk(table, t), tenantFk(table, t), tenantIsolation()] as const;
}

