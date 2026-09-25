import { sql } from 'drizzle-orm';

/**
 * 全テーブル共通のテナント分離ポリシー。`tenant_id`カラムを持つテーブルに適用する。
 *
 * `current_setting('app.tenant_id', true)` の第2引数 true は「未設定ならエラーにせずNULLを返す」
 * 指定。NULL = tenant_id は常にfalseになるため、テナントコンテキストを張り忘れた接続からは
 * 何も見えない(安全側に倒れる)。マイグレーション等はテーブル所有者(katahimo)で実行し、
 * 所有者はPostgreSQLの仕様上RLSを常にバイパスするため、この条件の影響を受けない。
 *
 * withTenant()(../client.ts)が `SET LOCAL app.tenant_id` でこの設定を張る。
 */
export const TENANT_RLS_USING = sql`tenant_id = current_setting('app.tenant_id', true)::uuid`;
