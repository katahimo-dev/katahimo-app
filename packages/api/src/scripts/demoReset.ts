import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { provisionTenant } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import {
  DrizzleTenantCalendarSettingsStore,
  DrizzleTenantDirectory,
  DrizzleTenantProvisioning,
} from '@katahimo/db/repositories';
import { sql } from 'drizzle-orm';
import type { Container } from '../container';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { cliArgs } from './cliArgs';
import { type DemoSeedSummary, seedDemoTenant } from './demo/seedDemoTenant';

const DEMO_TENANT_NAME = 'かたひも訪問サポート(デモ)';

export interface DemoResetResult {
  tenantId: string;
  /** 消去前に既存のテナントがあったか(2回目以降の実行なら true)。 */
  replacedExisting: boolean;
  summary: DemoSeedSummary;
}

/**
 * デモテナントの領収書画像を、DB を消す前に消しておく(ベストエフォート。バイナリはDBの外(ローカル
 * ディスク/GCS)にあり、テナントの消去(purge_tenant)では消えないため)。1件ずつ消し、失敗しても止めない。
 */
async function deleteReceiptBlobs(container: Container, tenantId: string): Promise<number> {
  const keys = await container.uow.run(tenantId, async (r) => {
    const rows = await r.receipts.list(
      { from: new Date(0), to: new Date('2999-01-01T00:00:00Z'), includeCancelled: true },
      null,
      2000,
    );
    const found: string[] = [];
    for (const row of rows) {
      const image = await r.receipts.findImage(row.id);
      if (image) found.push(image.storageKey);
    }
    return found;
  });
  let deleted = 0;
  for (const key of keys) {
    try {
      await container.storage.delete(key);
      deleted++;
    } catch (error) {
      console.warn(`[demo:reset] 画像の削除に失敗しました(key=${key}): ${String(error)}`);
    }
  }
  return deleted;
}

/**
 * 既存のテナントを消去する(platform.purge_tenant は status='terminated' のテナントしか消せない。
 * doc/03 §5 / packages/db/drizzle/0001_baseline_custom.sql)。所有者の接続(MIGRATION_DATABASE_URL)で行う。
 */
async function terminateAndPurgeTenant(ownerDb: ReturnType<typeof createDatabase>, tenantId: string) {
  await ownerDb.execute(
    sql`update platform.tenants set status = 'terminated', terminated_at = now() where id = ${tenantId}::uuid`,
  );
  await ownerDb.execute(sql`select platform.purge_tenant(${tenantId}::uuid)`);
}

/**
 * 公開デモ用テナントを消去して作り直す(呼び出し側 = CLI(main)と結合テストの両方から使う本体。
 * slug の安全確認(DEMO_TENANT_SLUG との一致・"demo" の拒否)は呼び出し側の責務)。
 */
export async function resetDemoTenant(
  ownerDb: ReturnType<typeof createDatabase>,
  container: Container,
  slug: string,
  now: Date = new Date(),
): Promise<DemoResetResult> {
  const tenantDirectory = new DrizzleTenantDirectory(ownerDb);
  const provisioning = new DrizzleTenantProvisioning(ownerDb);

  const calendarSettings = new DrizzleTenantCalendarSettingsStore(ownerDb);

  const existing = await tenantDirectory.findBySlug(slug);
  // 運用担当者の設定(`pnpm tenant:calendars` の共有カレンダー等)はテナントの行にあり、消去で消えるため引き継ぐ
  const keptCalendarSettings = existing ? await calendarSettings.get(existing.id) : null;
  if (existing) {
    console.log(`[demo:reset] 既存のテナントを消去します: ${existing.name} (id=${existing.id})`);
    const deletedBlobs = await deleteReceiptBlobs(container, existing.id);
    console.log(`[demo:reset] 領収書画像を削除しました: ${deletedBlobs}件`);
    await terminateAndPurgeTenant(ownerDb, existing.id);
    console.log('[demo:reset] テナントを消去しました');
  } else {
    console.log('[demo:reset] 既存のテナントはありません(初回作成)');
  }

  const { tenant } = await provisionTenant(
    { tenants: tenantDirectory, provisioning },
    { slug, name: DEMO_TENANT_NAME, timezone: 'Asia/Tokyo' },
  );
  console.log(`[demo:reset] テナントを作成しました: ${tenant.name} (slug=${tenant.slug}, id=${tenant.id})`);
  if (keptCalendarSettings) {
    await calendarSettings.set(tenant.id, keptCalendarSettings);
    console.log(
      `[demo:reset] カレンダーの設定を引き継ぎました(共有カレンダー ${keptCalendarSettings.sharedCalendars.length}件)`,
    );
  }

  const summary = await seedDemoTenant(container, tenant, now);
  return { tenantId: tenant.id, replacedExisting: existing !== null, summary };
}

function printSummary(summary: DemoSeedSummary) {
  console.log('');
  console.log('=== デモデータの投入結果 ===');
  console.log(`スタッフ: ${summary.staffCount}人`);
  console.log(`顧客: ${summary.customerCount}世帯`);
  console.log(`教育思考★を設定した世帯: ${summary.reportProfileCount}件`);
  console.log(`日報: ${summary.dailyReportCount}件`);
  console.log(`事故報告・ヒヤリハット: ${summary.accidentReportCount}件`);
  console.log(`出勤簿: ${summary.attendanceDayCount}日ぶん`);
  console.log(`領収書: ${summary.receiptCount}件`);
  console.log(`履歴の最終日: ${summary.generatedThrough}`);
}

/**
 * `pnpm demo:reset -- <slug>`。安全のため、`DEMO_TENANT_SLUG` と一致する slug だけ受け付け、
 * 開発用シード・e2e のテナント `demo` は明示的に拒む(どちらも誤って別のテナントを消さないための歯止め)。
 */
async function main() {
  const env = loadEnv();
  const [slug] = cliArgs();
  if (!slug) throw new Error('使い方: pnpm demo:reset -- <公開デモ用テナントの slug>');
  if (slug === 'demo') {
    throw new Error(
      'slug "demo" は開発用シード(pnpm db:seed)・e2e が使うテナントのため、demo:reset では扱えません',
    );
  }
  if (!env.DEMO_TENANT_SLUG || slug !== env.DEMO_TENANT_SLUG) {
    throw new Error(
      `demo:reset は環境変数 DEMO_TENANT_SLUG(${env.DEMO_TENANT_SLUG ?? '未設定'})と一致する slug しか受け付けません(誤って別のテナントを消さないため): ${slug}`,
    );
  }
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error('demo:reset には MIGRATION_DATABASE_URL(katahimo_migrator)が必要です');

  const ownerDb = createDatabase(migrationUrl, { max: 1, onnotice: () => {} });
  const appDb = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, appDb);
    const { summary } = await resetDemoTenant(ownerDb, container, slug);
    printSummary(summary);
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
