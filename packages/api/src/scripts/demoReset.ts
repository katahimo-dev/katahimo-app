import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { addDays, isValidBusinessDate, newId, zonedBusinessDate } from '@katahimo/core/domain';
import type { StoredFileRow } from '@katahimo/core/ports';
import { provisionTenant, readTenantSecrets, usableSecretValue } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, withTenant } from '@katahimo/db';
import {
  DrizzleTenantCalendarSettingsStore,
  DrizzleTenantDirectory,
  DrizzleTenantProvisioning,
} from '@katahimo/db/repositories';
import { sql } from 'drizzle-orm';
import type { Container } from '../container';
import { createContainer } from '../container';
import { demoResetRetentionDays, loadEnv } from '../env';
import { cliArgs } from './cliArgs';
import { type DemoSeedSummary, seedDemoTenant } from './demo/seedDemoTenant';

/** デモ用テナントの名前。既存のテナントを残す・消すのは、この名前(demo:reset が作った印)のときだけ。 */
export const DEMO_TENANT_NAME = 'かたひも訪問サポート(デモ)';

/** 残した過去のデモ用テナントの slug の重なりを避ける連番の上限(`<slug>-YYYYMMDD-999`)。 */
const DEMO_ARCHIVE_SEQ_MAX = 999;
/** テナントの slug の最大長(platform.tenants の CHECK `^[a-z0-9][a-z0-9-]{1,62}$`)。 */
const TENANT_SLUG_MAX_LENGTH = 63;
/** 日付と連番を付けても slug の最大長に収まる、元の slug の最大長(`-YYYYMMDD` と `-999` の分を引く)。 */
export const DEMO_RESET_SLUG_MAX_LENGTH = TENANT_SLUG_MAX_LENGTH - '-YYYYMMDD'.length - '-999'.length;

export interface DemoResetOptions {
  /** 残した過去のデモ用テナントを消すまでの日数(DEMO_DATA_RETENTION_DAYS。未設定なら 30)。 */
  dataRetentionDays: number;
}

export interface DemoResetResult {
  tenantId: string;
  /** 前のデモ用テナントを日付付きの slug で残した(初回・前回の作成途中のテナントを消した場合は null)。 */
  archived: { tenantId: string; slug: string } | null;
  /** 前回の作り直しが途中で止まり作成中のまま残っていた(または解約済みの)テナントを、残さずに消した。 */
  discardedIncomplete: boolean;
  /** 保存期間を過ぎたため消した、過去のデモ用テナントの slug。 */
  purged: string[];
  /** 消せなかった過去のデモ用テナント(次回の作り直しでもう一度消す)。 */
  purgeFailures: Array<{ slug: string; error: string }>;
  summary: DemoSeedSummary;
}

/**
 * 残すテナントの日付(YYYY-MM-DD)。作り直しは毎晩の利用の少ない時間(03:30 JST)に流すため、前のテナントには
 * 「作り直した日の前日」に訪問者が入力したものが入っている。その日(テナントのタイムゾーンの業務日の前日)を
 * slug に付けて、どの日のデモかが分かるようにし、保存期間もこの日から数える。昼間に手で流した場合も前日になる
 * (同じ日付のものが既にあれば連番を付ける)。
 */
export function demoArchiveDate(now: Date, timeZone: string): string {
  return addDays(zonedBusinessDate(now, timeZone), -1);
}

/** 残すテナントの slug(`<slug>-YYYYMMDD`、2つ目以降は `-2`, `-3`…)。 */
export function demoArchiveSlug(slug: string, archiveDate: string, seq: number): string {
  const base = `${slug}-${archiveDate.replaceAll('-', '')}`;
  return seq <= 1 ? base : `${base}-${seq}`;
}

/**
 * 残した過去のデモ用テナントの slug(`<slug>-YYYYMMDD` / `<slug>-YYYYMMDD-N`)なら、その日付(YYYY-MM-DD)。
 * それ以外(日付として正しくないものを含む)は null(消す対象にしない)。
 */
export function parseDemoArchiveSlug(slug: string, candidate: string): string | null {
  if (!candidate.startsWith(`${slug}-`)) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:-([1-9]\d{0,2}))?$/.exec(candidate.slice(slug.length + 1));
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidBusinessDate(date) ? date : null;
}

/**
 * 保存期間を過ぎたか。今日(テナントのタイムゾーンの業務日)から数えて retentionDays 日前より前の日付なら消す
 * (30日なら、今日の作り直しで残した前日の分を含めて、直近の30日分を残す)。
 */
export function isExpiredDemoArchive(archiveDate: string, today: string, retentionDays: number): boolean {
  return archiveDate < addDays(today, -retentionDays);
}

/**
 * デモテナントの保存先の実体(領収書の画像等。DB の外のローカルディスク/GCS)を、DB を消す前に消しておく
 * (テナントの消去(purge_tenant)では消えず、消した後は掃除のジョブも行を辿れないため)。stored_files を ID 順に
 * 最後まで読み、1件ずつ消す(1件の失敗で止めずに続け、失敗の数を返す。無い実体の削除は成功として扱われる)。
 */
export async function deleteStoredBlobs(
  container: Container,
  tenantId: string,
): Promise<{ deleted: number; failed: number }> {
  const PAGE = 500;
  const keys: string[] = [];
  let afterId: string | null = null;
  for (;;) {
    const cursor: string | null = afterId;
    const page: StoredFileRow[] = await container.uow.run(tenantId, (r) =>
      r.storedFiles.listPage(cursor, PAGE),
    );
    keys.push(...page.map((f) => f.storageKey));
    if (page.length < PAGE) break;
    afterId = page[page.length - 1]?.id ?? null;
  }
  let deleted = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      await container.storage.delete(key);
      deleted++;
    } catch (error) {
      failed++;
      console.warn(`[demo:reset] 画像の削除に失敗しました(key=${key}): ${String(error)}`);
    }
  }
  return { deleted, failed };
}

/**
 * CLI の引数の slug を確かめる(誤って別のテナントを扱わないための歯止め)。`DEMO_TENANT_SLUG` と一致する slug だけを受け付け、
 * 開発用シード・e2e のテナント `demo` は常に断る。日付と連番を付けた slug が長さの上限を超える slug も断る。
 * 問題があれば日本語の理由、無ければ null。
 */
export function demoResetTargetProblem(
  slug: string | undefined,
  demoTenantSlug: string | undefined,
): string | null {
  if (!slug) return '使い方: pnpm demo:reset -- <公開デモ用テナントの slug>';
  if (slug === 'demo') {
    return 'slug "demo" は開発用シード(pnpm db:seed)・e2e が使うテナントのため、demo:reset では扱えません';
  }
  if (!demoTenantSlug || slug !== demoTenantSlug) {
    return `demo:reset は環境変数 DEMO_TENANT_SLUG(${demoTenantSlug ?? '未設定'})と一致する slug しか受け付けません(誤って別のテナントを消さないため): ${slug}`;
  }
  if (slug.length > DEMO_RESET_SLUG_MAX_LENGTH) {
    return `demo:reset の slug は ${DEMO_RESET_SLUG_MAX_LENGTH} 文字までにしてください(前日のデモを「<slug>-YYYYMMDD」で残すため): ${slug}`;
  }
  return null;
}

type OwnerDb = ReturnType<typeof createDatabase>;

/** 作り直しの前にあっても日付付きで残さず、消すテナントの状態。 */
const DISCARDED_STATUSES: ReadonlySet<string> = new Set(['provisioning', 'terminating', 'terminated']);

/** テナントの状態遷移の記録(platform.tenant_lifecycle_events。消去の後も残る証跡)。 */
async function recordLifecycle(
  tx: Pick<OwnerDb, 'execute'>,
  tenantId: string,
  event: 'suspended' | 'terminated' | 'purged',
  details: Record<string, unknown>,
) {
  await tx.execute(
    sql`insert into platform.tenant_lifecycle_events (id, tenant_id, event, actor, details)
        values (${newId()}::uuid, ${tenantId}::uuid, ${event}, session_user, ${JSON.stringify({ by: 'demo:reset', ...details })}::jsonb)`,
  );
}

/**
 * テナントを消去する(platform.purge_tenant は status='terminated' のテナントしか消せない。doc/03 §5 /
 * packages/db/drizzle/0001_baseline_custom.sql)。所有者の接続(MIGRATION_DATABASE_URL)で、slug と状態が
 * 読んだときのままであることを確かめてから1つのトランザクションで行う(途中で止まっても半端に残らない)。
 */
async function terminateAndPurgeTenant(
  ownerDb: OwnerDb,
  tenant: { id: string; slug: string; status: string },
  reason: string,
) {
  await ownerDb.transaction(async (tx) => {
    const updated = await tx.execute(
      sql`update platform.tenants set status = 'terminated', terminated_at = now()
          where id = ${tenant.id}::uuid and slug = ${tenant.slug} and status = ${tenant.status} returning id`,
    );
    if (updated.length !== 1) {
      throw new Error(`テナントの状態が変わったため消しません(slug=${tenant.slug})`);
    }
    await recordLifecycle(tx, tenant.id, 'terminated', { reason, slug: tenant.slug });
    await tx.execute(sql`select platform.purge_tenant(${tenant.id}::uuid)`);
    await recordLifecycle(tx, tenant.id, 'purged', { reason, slug: tenant.slug });
  });
}

/** 画像を消してからテナントを消去する。画像を1件でも消せなければテナントは消さない(画像だけが残らないように)。 */
async function purgeDemoTenant(
  ownerDb: OwnerDb,
  container: Container,
  tenant: { id: string; slug: string; status: string },
  reason: string,
): Promise<number> {
  const blobs = await deleteStoredBlobs(container, tenant.id);
  if (blobs.failed > 0) {
    throw new Error(`画像を${blobs.failed}件消せなかったため、テナントは消しません(slug=${tenant.slug})`);
  }
  await terminateAndPurgeTenant(ownerDb, tenant, reason);
  return blobs.deleted;
}

/** 前のデモ用テナントの、まだ使われていない日付付きの slug。 */
async function freeArchiveSlug(
  tenants: DrizzleTenantDirectory,
  slug: string,
  archiveDate: string,
): Promise<string> {
  for (let seq = 1; seq <= DEMO_ARCHIVE_SEQ_MAX; seq++) {
    const candidate = demoArchiveSlug(slug, archiveDate, seq);
    if (!(await tenants.findBySlug(candidate))) return candidate;
  }
  throw new Error(`残すテナントの slug が空いていません(${demoArchiveSlug(slug, archiveDate, 1)})`);
}

/**
 * 前のデモ用テナントを残す: slug を日付付き(`<slug>-YYYYMMDD`)に変えて停止(suspended)にし、セッション・
 * 通知の購読を消す(誰もログインしたままにならない。停止中のテナントはログインもセッションも通らない)。
 * データ・保存先の画像・操作ログはそのまま残す(保存期間を過ぎたら purgeExpiredDemoArchives が消す)。
 * 1つのトランザクションで行い、slug が読んだときのままであることを確かめる。
 */
async function archiveDemoTenant(
  ownerDb: OwnerDb,
  tenant: { id: string; slug: string; timezone: string },
  now: Date,
): Promise<string> {
  const archiveDate = demoArchiveDate(now, tenant.timezone);
  const archivedSlug = await freeArchiveSlug(new DrizzleTenantDirectory(ownerDb), tenant.slug, archiveDate);
  await withTenant(ownerDb, tenant.id, async (tx) => {
    await tx.execute(sql`delete from public.sessions where tenant_id = ${tenant.id}::uuid`);
    await tx.execute(sql`delete from public.push_subscriptions where tenant_id = ${tenant.id}::uuid`);
    const updated = await tx.execute(
      sql`update platform.tenants set slug = ${archivedSlug}, status = 'suspended'
          where id = ${tenant.id}::uuid and slug = ${tenant.slug} returning id`,
    );
    if (updated.length !== 1) throw new Error(`テナントの slug が変わったため残せません(${tenant.slug})`);
    await recordLifecycle(tx, tenant.id, 'suspended', {
      reason: 'demo_archive',
      previousSlug: tenant.slug,
      archivedSlug,
    });
  });
  return archivedSlug;
}

/**
 * 保存期間(DEMO_DATA_RETENTION_DAYS)を過ぎた、残した過去のデモ用テナントを消す。対象は slug が
 * `<slug>-YYYYMMDD(-N)`、名前が DEMO_TENANT_NAME、状態が停止(suspended)の3つが全て合うものだけ
 * (それ以外のテナントには触れない)。日付は slug の日付(archiveDemoTenant が付けた、訪問者が使った日)で数える。
 * 1つ消せなくても他は続け、消せなかったものは次回の作り直しでもう一度消す。
 */
export async function purgeExpiredDemoArchives(
  ownerDb: OwnerDb,
  container: Container,
  slug: string,
  now: Date,
  retentionDays: number,
): Promise<{ purged: string[]; failures: Array<{ slug: string; error: string }> }> {
  const purged: string[] = [];
  const failures: Array<{ slug: string; error: string }> = [];
  for (const tenant of await new DrizzleTenantDirectory(ownerDb).listAll()) {
    const archiveDate = parseDemoArchiveSlug(slug, tenant.slug);
    if (!archiveDate || tenant.name !== DEMO_TENANT_NAME || tenant.status !== 'suspended') continue;
    if (!isExpiredDemoArchive(archiveDate, zonedBusinessDate(now, tenant.timezone), retentionDays)) continue;
    try {
      const blobs = await purgeDemoTenant(ownerDb, container, tenant, 'demo_archive_expired');
      purged.push(tenant.slug);
      console.log(`[demo:reset] 保存期間を過ぎたデモを消しました: ${tenant.slug}(画像 ${blobs}件)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ slug: tenant.slug, error: message });
      console.error(`[demo:reset] 保存期間を過ぎたデモを消せませんでした: ${tenant.slug}: ${message}`);
    }
  }
  return { purged, failures };
}

/**
 * 引き継ぐ Gemini の API キー(無ければ空文字)。開けないとき(ジョブに KMS の権限が無い等)はジョブの出力に警告を出す。
 */
async function readKeptGeminiApiKey(container: Container, tenantId: string): Promise<string> {
  const { gemini_api_key: secret } = await readTenantSecrets(container, tenantId, ['gemini_api_key']);
  if (secret.state === 'unreadable') {
    console.warn(
      '[demo:reset] 保存済みの Gemini の API キーを開けないため引き継ぎません(ジョブのサービスアカウントの KMS の権限・SECRET_BOX_* を確かめる)',
    );
  }
  return usableSecretValue(secret);
}

/**
 * 公開デモ用テナントを作り直す(呼び出し側 = CLI(main)と結合テストの両方から使う本体。slug の安全確認
 * (DEMO_TENANT_SLUG との一致・"demo" の拒否)は呼び出し側の責務)。
 * 1. 前のテナント(名前が DEMO_TENANT_NAME でなければ止まる)の運用担当者のカレンダーの設定と Gemini の API キーを読む
 * 2. 前のテナントを日付付きの slug で停止にして残す(archiveDemoTenant)。前回の作り直しが途中で止まって作成中
 *    (status = provisioning。誰もログインしていない)のまま残っていたテナント(と解約の手続き中・解約済みのもの)は、
 *    残さずに消す
 * 3. 同じ slug で作成中のテナントを作り、設定・キーを引き継いでデータを入れ、最後に利用できる(active)状態にする
 * 4. 保存期間を過ぎた過去のデモ用テナントを消す(purgeExpiredDemoArchives)
 * どこで止まっても、もう一度流せば正しく作り直す(2 は1つのトランザクション、3 は作成中のまま残るので次回の 2 で消す)。
 */
export async function resetDemoTenant(
  ownerDb: OwnerDb,
  container: Container,
  slug: string,
  options: DemoResetOptions,
  now: Date = new Date(),
): Promise<DemoResetResult> {
  const tenantDirectory = new DrizzleTenantDirectory(ownerDb);
  const provisioning = new DrizzleTenantProvisioning(ownerDb);
  const calendarSettings = new DrizzleTenantCalendarSettingsStore(ownerDb);

  const existing = await tenantDirectory.findBySlug(slug);
  if (existing && existing.name !== DEMO_TENANT_NAME) {
    // demo:reset が作ったテナントでなければ触れない(slug の取り違えで本物のテナントを止めない・消さないための2つ目の歯止め)
    throw new Error(
      `slug ${slug} のテナントは demo:reset が作ったもの(名前「${DEMO_TENANT_NAME}」)ではないため、消しません: ${existing.name}`,
    );
  }
  // 運用担当者の設定(`pnpm tenant:calendars` の共有カレンダー等)はテナントの行にあるため新しいテナントへ写す
  const keptCalendarSettings = existing ? await calendarSettings.get(existing.id) : null;
  // 管理画面で保存した Gemini の API キーも引き継ぐ(封はテナントの ID に結び付くので、開いて新しいテナントで封をし直す。
  // 本物のテナントの秘密値を開かないよう、名前を確かめた後、残す・消す前に読む)
  const keptGeminiApiKey = existing ? await readKeptGeminiApiKey(container, existing.id) : '';

  let archived: DemoResetResult['archived'] = null;
  let discardedIncomplete = false;
  // 作成中(前回の作り直しが途中で止まった。誰もログインしていない)・解約の手続き中/解約済み(運用担当者が消すと
  // 決めたもの)は残さずに消す
  if (existing && DISCARDED_STATUSES.has(existing.status)) {
    console.log(
      `[demo:reset] ${existing.status} のまま残ったテナントを、残さずに消します (id=${existing.id})`,
    );
    await purgeDemoTenant(ownerDb, container, existing, 'demo_reset_incomplete');
    discardedIncomplete = true;
  } else if (existing) {
    const archivedSlug = await archiveDemoTenant(ownerDb, existing, now);
    archived = { tenantId: existing.id, slug: archivedSlug };
    console.log(`[demo:reset] 前のテナントを停止して残しました: ${archivedSlug} (id=${existing.id})`);
  } else {
    console.log('[demo:reset] 既存のテナントはありません(初回作成)');
  }

  const { tenant } = await provisionTenant(
    { tenants: tenantDirectory, provisioning },
    { slug, name: DEMO_TENANT_NAME, timezone: 'Asia/Tokyo' },
  );
  // データを入れ終わるまでは作成中(ログインできない。途中で止まったら次回の作り直しで消す)
  await setTenantStatus(ownerDb, tenant.id, 'provisioning');
  console.log(`[demo:reset] テナントを作成しました: ${tenant.name} (slug=${tenant.slug}, id=${tenant.id})`);
  if (keptCalendarSettings) {
    await calendarSettings.set(tenant.id, keptCalendarSettings);
    console.log(
      `[demo:reset] カレンダーの設定を引き継ぎました(共有カレンダー ${keptCalendarSettings.sharedCalendars.length}件)`,
    );
  }
  if (keptGeminiApiKey) {
    const sealed = await container.secretBox.seal(tenant.id, 'gemini_api_key', keptGeminiApiKey);
    await container.uow.run(tenant.id, (r) => r.secrets.put('gemini_api_key', sealed, null));
    console.log('[demo:reset] Gemini の API キーを引き継ぎました');
  }

  const summary = await seedDemoTenant(container, tenant, now);
  await setTenantStatus(ownerDb, tenant.id, 'active');

  // 古いデモを消せなくても、新しいデモは使える状態で終える(ジョブを失敗にすると、もう一度流したときに今作った
  // デモを残し直してしまうため)。消せなかったものは次回の作り直しでもう一度消す
  let purged: string[] = [];
  let failures: DemoResetResult['purgeFailures'] = [];
  try {
    ({ purged, failures } = await purgeExpiredDemoArchives(
      ownerDb,
      container,
      slug,
      now,
      options.dataRetentionDays,
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures = [{ slug: '(一覧)', error: message }];
    console.error(`[demo:reset] 保存期間を過ぎたデモを探せませんでした: ${message}`);
  }
  return {
    tenantId: tenant.id,
    archived,
    discardedIncomplete,
    purged,
    purgeFailures: failures,
    summary,
  };
}

async function setTenantStatus(ownerDb: OwnerDb, tenantId: string, status: 'provisioning' | 'active') {
  await ownerDb.execute(sql`update platform.tenants set status = ${status} where id = ${tenantId}::uuid`);
}

function printSummary(result: DemoResetResult) {
  const { summary } = result;
  console.log('');
  console.log('=== デモの作り直しの結果 ===');
  console.log(`前のデモ: ${result.archived ? `${result.archived.slug} として停止して残した` : 'なし'}`);
  if (result.discardedIncomplete) console.log('前回の作成途中のテナント: 消した');
  console.log(
    `保存期間を過ぎて消したデモ: ${result.purged.length}件${result.purged.length ? `(${result.purged.join(', ')})` : ''}`,
  );
  if (result.purgeFailures.length) {
    console.log(`消せなかったデモ(次回もう一度消す): ${result.purgeFailures.map((f) => f.slug).join(', ')}`);
  }
  console.log('');
  console.log('=== デモデータの投入結果 ===');
  console.log(`スタッフ: ${summary.staffCount}人`);
  console.log(`顧客: ${summary.customerCount}世帯`);
  console.log(`教育思考★を設定した世帯: ${summary.reportProfileCount}件`);
  console.log(`日報: ${summary.dailyReportCount}件`);
  console.log(`事故報告・ヒヤリハット: ${summary.accidentReportCount}件`);
  console.log(`出勤簿: ${summary.attendanceDayCount}日ぶん`);
  console.log(`領収書: ${summary.receiptCount}件`);
  console.log(`今日・明日の予定(予約): ${summary.reservationCount}件`);
  console.log(`履歴の最終日: ${summary.generatedThrough}`);
}

/**
 * `pnpm demo:reset -- <slug>`。安全のため、`DEMO_TENANT_SLUG` と一致する slug だけ受け付け、
 * 開発用シード・e2e のテナント `demo` は明示的に拒む(どちらも誤って別のテナントを消さないための歯止め)。
 */
async function main() {
  const env = loadEnv();
  const [slug] = cliArgs();
  const problem = demoResetTargetProblem(slug, env.DEMO_TENANT_SLUG);
  if (problem || !slug) throw new Error(problem ?? '');
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error('demo:reset には MIGRATION_DATABASE_URL(katahimo_migrator)が必要です');

  const ownerDb = createDatabase(migrationUrl, { max: 1, onnotice: () => {} });
  const appDb = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, appDb);
    const result = await resetDemoTenant(ownerDb, container, slug, {
      // 未設定なら 30 日(API の案内は本番の環境では期間を出さないが、作り直しのジョブは必ず期限で消す)
      dataRetentionDays: demoResetRetentionDays(env),
    });
    printSummary(result);
  } finally {
    await Promise.all([closeDatabase(ownerDb), closeDatabase(appDb)]);
  }
}

if (process.env.VITEST === undefined) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
