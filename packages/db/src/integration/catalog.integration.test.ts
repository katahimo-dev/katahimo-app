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
    // role_table_grants は接続したロールに関わる権限しか見せないため has_table_privilege で調べる
    const grants = await rows<{ table: string; grantee: string; privilege: string }>(sql`
      select c.relname as table, g.grantee, p.privilege
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['katahimo_app', 'katahimo_worker']) as g(grantee)
      cross join unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
        and has_table_privilege(g.grantee, c.oid, p.privilege)`);
    expect(grants.filter((g) => APPEND_ONLY.includes(g.table))).toEqual([]);
    expect(grants.filter((g) => g.privilege === 'TRUNCATE')).toEqual([]);
  });

  it('ワーカーは認証情報・秘密値を読めず、アプリは outbox の状態・テナントを変えられない', async () => {
    const has = async (role: string, table: string, privilege: string) =>
      (await rows<{ ok: boolean }>(sql`select has_table_privilege(${role}, ${table}, ${privilege}) as ok`))[0]
        ?.ok;
    expect(await has('katahimo_worker', 'tenant_secrets', 'SELECT')).toBe(false);
    expect(await has('katahimo_worker', 'staff_credentials', 'SELECT')).toBe(false);
    expect(await has('katahimo_app', 'outbox_messages', 'UPDATE')).toBe(false);
    expect(await has('katahimo_app', 'platform.tenants', 'UPDATE')).toBe(false);
  });

  it('領収書は会計の記録: アプリは消せず、登録の後に変えられるのは取消の列・版・重複の判定の代表だけ', async () => {
    const ok = async (query: ReturnType<typeof sql>) =>
      (await rows<{ ok: boolean }>(sql`select ${query} as ok`))[0]?.ok;
    for (const table of ['receipts', 'receipt_uploads']) {
      expect(await ok(sql`has_table_privilege('katahimo_app', ${table}, 'DELETE')`)).toBe(false);
      expect(await ok(sql`has_table_privilege('katahimo_app', ${table}, 'UPDATE')`)).toBe(false);
      expect(await ok(sql`has_table_privilege('katahimo_app', ${table}, 'INSERT')`)).toBe(true);
    }
    const updatable = await rows<{ column: string }>(sql`
      select a.attname as column from pg_attribute a
      where a.attrelid = 'public.receipts'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('katahimo_app', a.attrelid, a.attnum, 'UPDATE')
      order by a.attname`);
    expect(updatable.map((c) => c.column)).toEqual([
      'cancel_reason',
      'cancelled_at',
      'cancelled_by',
      'dedupe_primary',
      'row_version',
    ]);
  });

  it('ワーカーはジョブが使う表・操作だけを持つ(認証情報・秘密値・AIプロンプト・マッチングの表には触れない)', async () => {
    // information_schema.role_table_grants は接続したロール(katahimo_app)に関わる権限しか見せないため、
    // has_table_privilege でワーカーの権限を調べる
    const privileges = await rows<{ table: string; privilege: string }>(sql`
      select n.nspname || '.' || c.relname as table, p.privilege
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
      where n.nspname in ('public', 'platform') and c.relkind in ('r', 'p') and not c.relispartition
        and has_table_privilege('katahimo_worker', c.oid, p.privilege)`);
    const of = (table: string) =>
      privileges
        .filter((p) => p.table === table)
        .map((p) => p.privilege)
        .sort();
    const none = [
      'staff_credentials',
      'tenant_secrets',
      'ai_prompts',
      'ai_prompt_revisions',
      'care_record_revisions',
      'matching_runs',
      'reservation_recipients',
      'customer_staff_affinities',
      'customer_preferences',
      'tenant_features',
      'custom_field_definitions',
      'retention_policies',
      'data_subject_requests',
      'travel_time_cache',
      'report_keywords',
      'report_age_bands',
      'report_education_levels',
      'report_psi_levels',
      'report_phrases',
      'report_stance_rules',
      'customer_report_profiles',
      'legacy_imported_rows',
    ];
    expect(none.filter((t) => of(`public.${t}`).length > 0)).toEqual([]);
    // 読むだけ・消すだけの表
    expect(of('public.care_records')).toEqual(['SELECT']);
    expect(of('public.staff')).toEqual(['SELECT']);
    expect(of('public.attendance_periods')).toEqual(['SELECT']);
    // SCHEDULE_PROVIDER=database の予定(確定した予約)を夜間の反映・翌日のお知らせで読むだけ
    expect(of('public.reservations')).toEqual(['SELECT']);
    expect(of('public.reservation_assignments')).toEqual(['SELECT']);
    expect(of('public.matching_run_candidates')).toEqual(['DELETE', 'SELECT']);
    expect(of('public.entity_changes')).toEqual(['INSERT']);
    expect(of('public.customers')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    expect(of('public.push_subscriptions')).toEqual(['DELETE', 'SELECT', 'UPDATE']);
    // AI 生成の記録は保存期間の削除だけ
    expect(of('public.report_ai_generations')).toEqual(['DELETE', 'SELECT']);
    expect(of('platform.plans')).toEqual([]);
  });

  it('アプリは AI 生成の記録を追記するだけ(後から書けるのは日報への結び付けの列だけ)・日報AIのマスターは消せない', async () => {
    const tablePrivileges = async (table: string) =>
      (
        await rows<{ privilege: string }>(sql`
          select p.privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
          where has_table_privilege('katahimo_app', ${table}, p.privilege)`)
      )
        .map((r) => r.privilege)
        .sort();
    const columnUpdate = async (column: string) =>
      (
        await rows<{ ok: boolean }>(
          sql`select has_column_privilege('katahimo_app', 'report_ai_generations', ${column}, 'UPDATE') as ok`,
        )
      )[0]?.ok;
    expect(await tablePrivileges('report_ai_generations')).toEqual(['INSERT', 'SELECT']);
    expect(await columnUpdate('care_record_id')).toBe(true);
    expect(await columnUpdate('output')).toBe(false);
    expect(await columnUpdate('prompt_text')).toBe(false);
    for (const table of [
      'report_keywords',
      'report_age_bands',
      'report_education_levels',
      'report_psi_levels',
      'report_phrases',
      'report_stance_rules',
      'customer_report_profiles',
    ]) {
      expect(await tablePrivileges(table)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    }
  });

  it('アプリ・ワーカーは月の締めを削除・付け替えできない(解除・削除は所有者の関数だけ)', async () => {
    const has = async (role: string, privilege: string) =>
      (
        await rows<{ ok: boolean }>(
          sql`select has_table_privilege(${role}, 'attendance_periods', ${privilege}) as ok`,
        )
      )[0]?.ok;
    expect(await has('katahimo_app', 'DELETE')).toBe(false);
    expect(await has('katahimo_worker', 'DELETE')).toBe(false);
    expect(await has('katahimo_worker', 'UPDATE')).toBe(false);
    // アプリが UPDATE できるのは締めの列だけ(締めた行を別の月・別のスタッフに付け替えられない)
    expect(await has('katahimo_app', 'UPDATE')).toBe(false);
    const updatable = await rows<{ column: string }>(sql`
      select a.attname as column from pg_attribute a
      where a.attrelid = 'public.attendance_periods'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('katahimo_app', a.attrelid, a.attnum, 'UPDATE')
      order by a.attname`);
    expect(updatable.map((c) => c.column)).toEqual(['locked_at', 'locked_by', 'status']);
    // 締めの守りの関数(締めの行のトリガー・勤怠の書き込みのトリガー・締めの判定)は search_path を固定する
    const pinned = await rows<{ name: string; config: string[] | null }>(sql`
      select p.oid::regprocedure::text as name, p.proconfig as config from pg_proc p
      where p.oid in (
        'public.guard_attendance_period()'::regprocedure,
        'public.enforce_attendance_period_lock()'::regprocedure,
        'public.attendance_period_is_locked(uuid, uuid, date)'::regprocedure
      )
      order by 1`);
    expect(pinned).toEqual([
      { name: 'attendance_period_is_locked(uuid,uuid,date)', config: ['search_path=pg_catalog, public'] },
      { name: 'enforce_attendance_period_lock()', config: ['search_path=pg_catalog, public'] },
      { name: 'guard_attendance_period()', config: ['search_path=pg_catalog, public'] },
    ]);
    // 締めの判定(領収書の登録・取消がトランザクションの中で呼ぶ)はアプリが実行できる
    const [execute] = await rows<{ ok: boolean }>(
      sql`select has_function_privilege('katahimo_app', 'public.attendance_period_is_locked(uuid, uuid, date)', 'EXECUTE') as ok`,
    );
    expect(execute?.ok).toBe(true);
  });

  it('アプリ・ワーカーの接続には文・ロック待ち・放置されたトランザクションの上限がある(infra の初期化SQL)', async () => {
    const settings = await rows<{ role: string; config: string[] }>(sql`
      select r.rolname as role, s.setconfig as config
      from pg_db_role_setting s
      join pg_roles r on r.oid = s.setrole
      join pg_database d on d.oid = s.setdatabase
      where d.datname = current_database() and r.rolname in ('katahimo_app', 'katahimo_worker')`);
    for (const role of ['katahimo_app', 'katahimo_worker']) {
      const names = (settings.find((s) => s.role === role)?.config ?? []).map((c) => c.split('=')[0]);
      expect(names.sort()).toEqual([
        'idle_in_transaction_session_timeout',
        'lock_timeout',
        'statement_timeout',
      ]);
    }
    // 実際の接続(katahimo_app)にも効いている
    const [current] = await rows<{ statement_timeout: string }>(
      sql`select current_setting('statement_timeout') as statement_timeout`,
    );
    expect(current?.statement_timeout).not.toBe('0');
  });

  it('操作ログのパーティションはアプリ・ワーカーから直接触れない(親の表を通す)', async () => {
    const partitions = await rows<{ name: string; app: boolean; worker: boolean }>(sql`
      select c.relname as name,
             has_table_privilege('katahimo_app', c.oid, 'SELECT') as app,
             has_table_privilege('katahimo_worker', c.oid, 'SELECT') as worker
      from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'public.app_logs'::regclass`);
    // 今月から12か月先まで + 既定のパーティション
    expect(partitions.length).toBeGreaterThanOrEqual(14);
    expect(partitions.map((p) => p.name)).toContain('app_logs_default');
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
