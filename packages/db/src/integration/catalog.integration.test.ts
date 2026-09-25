import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { connect } from './testDb';

/**
 * スキーマの約束事をカタログから確かめる(新しいテーブルを足したときの書き忘れを CI で見つける)。
 * - public の全テーブル: RLS を有効かつ FORCE、tenant_isolation ポリシー、所有者は katahimo_owner
 * - テナントのテーブルの主キーは tenant_id から始まり、テナントのテーブルへの外部キーは tenant_id を含む複合キー
 * - 追記専用のテーブルはアプリ・ワーカーに UPDATE・DELETE を与えない
 * - アプリ・ワーカーのロールは RLS をバイパスできない
 */
const { app } = connect();

const APPEND_ONLY = ['care_record_revisions', 'entity_changes', 'ai_prompt_revisions', 'app_logs'];

type Row = Record<string, unknown>;
const rows = async <T extends Row>(query: ReturnType<typeof sql>) =>
  (await app.execute(query)) as unknown as T[];

describe('スキーマの約束事(カタログ)', () => {
  it('public の全テーブルは RLS を FORCE で有効にし、tenant_isolation ポリシーを持ち、所有者は katahimo_owner', async () => {
    const tables = await rows<{
      name: string;
      rls: boolean;
      force: boolean;
      owner: string;
      policies: string[] | null;
    }>(sql`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force, pg_get_userbyid(c.relowner) as owner,
             (select array_agg(p.polname::text order by p.polname) from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition`);
    expect(tables.length).toBeGreaterThan(40);
    // 操作ログはテナントの無い記録(ログイン失敗等)も書くため、読み出し(app_logs_select)だけをテナントに限る
    const isolation = (name: string) => (name === 'app_logs' ? 'app_logs_select' : 'tenant_isolation');
    const problems = tables.filter(
      (t) =>
        !t.rls || !t.force || t.owner !== 'katahimo_owner' || !(t.policies ?? []).includes(isolation(t.name)),
    );
    expect(problems).toEqual([]);
  });

  it('テナントのテーブルの主キーは tenant_id から始まる', async () => {
    const pks = await rows<{ name: string; first: string }>(sql`
      select c.relname as name, a.attname as first
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
      where n.nspname = 'public' and k.contype = 'p' and c.relname <> 'app_logs' and not c.relispartition`);
    expect(pks.filter((p) => p.first !== 'tenant_id')).toEqual([]);
  });

  it('テナントのテーブルへの外部キーは全て tenant_id を含む複合キー(別テナントの行を指せない)', async () => {
    const fks = await rows<{ name: string; table: string; cols: string[]; refcols: string[] }>(sql`
      select k.conname as name, c.relname as table,
             (select array_agg(a.attname::text order by x.i) from unnest(k.conkey) with ordinality x(n, i)
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.n) as cols,
             (select array_agg(a.attname::text order by x.i) from unnest(k.confkey) with ordinality x(n, i)
                join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.n) as refcols
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_class rc on rc.oid = k.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
      where k.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'`);
    expect(fks.length).toBeGreaterThan(30);
    expect(fks.filter((f) => f.cols[0] !== 'tenant_id' || f.refcols[0] !== 'tenant_id')).toEqual([]);
  });

  it('追記専用のテーブルはアプリ・ワーカーが UPDATE・DELETE できない', async () => {
    const grants = await rows<{ table: string; grantee: string; privilege: string }>(sql`
      select table_name as table, grantee, privilege_type as privilege from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('katahimo_app', 'katahimo_worker')
        and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')`);
    expect(grants.filter((g) => APPEND_ONLY.includes(g.table))).toEqual([]);
    expect(grants.filter((g) => g.privilege === 'TRUNCATE')).toEqual([]);
  });

  it('アプリは鍵の表を読むだけ・ワーカーは認証情報を読めない', async () => {
    const has = async (role: string, table: string, privilege: string) =>
      (await rows<{ ok: boolean }>(sql`select has_table_privilege(${role}, ${table}, ${privilege}) as ok`))[0]
        ?.ok;
    expect(await has('katahimo_app', 'tenant_data_keys', 'SELECT')).toBe(true);
    expect(await has('katahimo_app', 'tenant_data_keys', 'INSERT')).toBe(false);
    expect(await has('katahimo_worker', 'staff_credentials', 'SELECT')).toBe(false);
    expect(await has('katahimo_app', 'outbox_messages', 'UPDATE')).toBe(false);
    expect(await has('katahimo_app', 'platform.tenants', 'UPDATE')).toBe(false);
  });

  it('操作ログのパーティションはアプリ・ワーカーから直接触れない(親の表を通す)', async () => {
    const partitions = await rows<{ name: string; app: boolean; worker: boolean }>(sql`
      select c.relname as name,
             has_table_privilege('katahimo_app', c.oid, 'SELECT') as app,
             has_table_privilege('katahimo_worker', c.oid, 'SELECT') as worker
      from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'public.app_logs'::regclass`);
    expect(partitions.length).toBeGreaterThanOrEqual(3);
    expect(partitions.filter((p) => p.app || p.worker)).toEqual([]);
  });

  it('アプリ・ワーカーのロールはスーパーユーザーでも RLS のバイパスでもない', async () => {
    const roles = await rows<{ name: string; superuser: boolean; bypass: boolean }>(sql`
      select rolname as name, rolsuper as superuser, rolbypassrls as bypass from pg_roles
      where rolname in ('katahimo_app', 'katahimo_worker', 'katahimo_owner', 'katahimo_migrator')`);
    expect(roles).toHaveLength(4);
    expect(roles.filter((r) => r.superuser || r.bypass)).toEqual([]);
  });
});
