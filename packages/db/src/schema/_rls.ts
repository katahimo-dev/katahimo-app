import { sql } from 'drizzle-orm';

/**
 * 全テーブル共通のテナント分離ポリシー。`tenant_id`カラムを持つテーブルに適用する。
 *
 * `current_setting('app.tenant_id', true)` の第2引数 true は「未設定ならエラーにせずNULLを返す」
 * 指定。NULL = tenant_id は常にfalseになるため、テナントコンテキストを張り忘れた接続からは
 * 何も見えない(安全側に倒れる)。全テーブルに FORCE ROW LEVEL SECURITY を掛けているため
 * (drizzle/0001_custom_constraints.sql)、テーブル所有者(katahimo)で接続しても同じ条件が効く。
 * マイグレーションはDDLだけでデータを読まないため影響を受けない。
 *
 * withTenant()(../client.ts)が `SET LOCAL app.tenant_id` でこの設定を張る。
 *
 * nullif(..., '') を挟む理由: 同じ接続で一度でも SET LOCAL したカスタム設定は、トランザクション
 * 終了後にNULLではなく空文字''に戻る(PostgreSQLの仕様)。コネクションプールで使い回された接続から
 * テナントコンテキスト無しで問い合わせると `''::uuid` のキャストエラーになってしまうため、空文字も
 * 未設定(NULL)として扱い、一貫して「0件」になるようにする。
 */
export const CURRENT_TENANT_ID = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;
export const TENANT_RLS_USING = sql`tenant_id = ${CURRENT_TENANT_ID}`;
