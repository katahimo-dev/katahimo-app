import { randomBytes } from 'node:crypto';
import { normalizeEmailForIndex } from '@katahimo/core/domain';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantCalendarSettingsStore } from '@katahimo/db/repositories';
import { DEMO_ACCOUNTS } from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { toJstDateIso } from './demo/visitPlan';
import { resetDemoTenant } from './demoReset';

/**
 * `pnpm demo:reset` の中身(resetDemoTenant)を実際の DB で確かめる。安全確認(DEMO_TENANT_SLUG との一致・
 * "demo" の拒否)は CLI 側(main)の責務なので、ここでは resetDemoTenant を直接呼ぶ(スクラッチの slug)。
 */
const slug = `demo-reset-it-${randomBytes(4).toString('hex')}`;
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
  GEMINI_API_KEY: '',
  DEMO_TENANT_SLUG: slug,
});
const appDb = createDatabase(env.DATABASE_URL, { max: 4 });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
const container = createContainer(env, appDb);

let lastTenantId: string | null = null;

afterAll(async () => {
  // 後始末(ベストエフォート): 作りっぱなしのテナントを消しておく。テスト自体の成否には影響させない。
  if (lastTenantId) {
    try {
      await ownerDb.execute(
        sql`update platform.tenants set status = 'terminated', terminated_at = now() where id = ${lastTenantId}::uuid`,
      );
      await ownerDb.execute(sql`select platform.purge_tenant(${lastTenantId}::uuid)`);
    } catch {
      // 無視(次回の demo:reset が同じ slug を上書きする)
    }
  }
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

describe('resetDemoTenant(実DB)', () => {
  it('1回目でテナント・スタッフ・顧客・日報・出勤簿・領収書を作り、2回目は全部作り直す', async () => {
    const now = new Date();

    const first = await resetDemoTenant(ownerDb, container, slug, now);
    lastTenantId = first.tenantId;
    expect(first.replacedExisting).toBe(false);
    expect(first.summary.staffCount).toBe(3);
    expect(first.summary.customerCount).toBe(20);
    expect(first.summary.dailyReportCount).toBeGreaterThan(0);
    expect(first.summary.attendanceDayCount).toBeGreaterThan(0);
    expect(first.summary.receiptCount).toBeGreaterThan(0);
    expect(first.summary.generatedThrough).toBe(toJstDateIso(now));

    // 当日ぶんの出勤簿が入っている(今週の予定タブが空にならない)ことを確かめる
    const staffAccount = DEMO_ACCOUNTS.find((a) => a.role === 'staff');
    if (!staffAccount) throw new Error('DEMO_ACCOUNTS に staff 役割がありません');
    const todayDay = await container.uow.run(first.tenantId, async (r) => {
      const staff = await r.staff.findByLoginEmail(normalizeEmailForIndex(staffAccount.email));
      if (!staff) throw new Error('デモ用スタッフが見つかりません');
      return r.attendance.loadDay(staff.id, toJstDateIso(now));
    });
    expect(todayDay.visits.length).toBeGreaterThan(0);

    // 運用担当者のカレンダーの設定は作り直しでも引き継ぐ
    const calendars = new DrizzleTenantCalendarSettingsStore(ownerDb);
    const settings = {
      sharedCalendars: [{ calendarId: 'demo-shared@group.calendar.google.com', ownerName: '予約' }],
      allowedStaffCalendars: [],
    };
    await calendars.set(first.tenantId, settings);

    const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const second = await resetDemoTenant(ownerDb, container, slug, later);
    lastTenantId = second.tenantId;
    expect(second.replacedExisting).toBe(true);
    expect(second.tenantId).not.toBe(first.tenantId);
    expect(second.summary.staffCount).toBe(3);
    expect(second.summary.customerCount).toBe(20);
    expect(second.summary.dailyReportCount).toBeGreaterThan(0);
    expect(second.summary.attendanceDayCount).toBeGreaterThan(0);
    expect(second.summary.generatedThrough).toBe(toJstDateIso(later));
    expect(await calendars.get(second.tenantId)).toEqual(settings);

    // 1回目のテナントは消えている(所有者接続で見ても見つからない)
    const gone = await ownerDb.execute(
      sql`select 1 from platform.tenants where id = ${first.tenantId}::uuid`,
    );
    expect((gone as unknown as unknown[]).length).toBe(0);
  }, 120_000);
});
