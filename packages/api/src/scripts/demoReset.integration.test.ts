import { randomBytes } from 'node:crypto';
import { addDays, newId, normalizeEmailForIndex, zonedBusinessDate } from '@katahimo/core/domain';
import {
  authenticateSession,
  createScheduleDirectory,
  login,
  provisionTenant,
  readTenantSecret,
} from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, withTenant } from '@katahimo/db';
import {
  DrizzleTenantCalendarSettingsStore,
  DrizzleTenantDirectory,
  DrizzleTenantProvisioning,
} from '@katahimo/db/repositories';
import { DatabaseSchedulePort } from '@katahimo/integrations';
import { AI_PROMPT_DEFINITIONS, DEMO_ACCOUNTS, DEMO_PASSWORD } from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { DEMO_FIGURES } from './demo/figures';
import { areaFigureIndexes } from './demo/staffAreas';
import { planVisitsForDate, toJstDateIso } from './demo/visitPlan';
import { DEMO_TENANT_NAME, purgeExpiredDemoArchives, resetDemoTenant } from './demoReset';

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

const RETENTION = { dataRetentionDays: 30 };
const DAY_MS = 24 * 60 * 60 * 1000;
const tenantDirectory = new DrizzleTenantDirectory(ownerDb);
const provisioningDeps = { tenants: tenantDirectory, provisioning: new DrizzleTenantProvisioning(ownerDb) };

/** テストで作ったテナント(後始末で消す)。 */
const createdTenantIds = new Set<string>();

afterAll(async () => {
  // 後始末(ベストエフォート): 作ったテナントを消しておく。テスト自体の成否には影響させない。
  for (const id of createdTenantIds) {
    try {
      await ownerDb.execute(
        sql`update platform.tenants set status = 'terminated', terminated_at = now() where id = ${id}::uuid`,
      );
      await ownerDb.execute(sql`select platform.purge_tenant(${id}::uuid)`);
    } catch {
      // 無視
    }
  }
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

async function tenantRow(id: string) {
  const rows = (await ownerDb.execute(
    sql`select slug, status, name from platform.tenants where id = ${id}::uuid`,
  )) as unknown as Array<{ slug: string; status: string; name: string }>;
  return rows[0] ?? null;
}

async function countIn(tenantId: string, table: 'sessions' | 'push_subscriptions' | 'care_records') {
  return withTenant(ownerDb, tenantId, async (tx) => {
    const rows = (await tx.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    )) as unknown as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  });
}

async function lifecycleEvents(tenantId: string) {
  const rows = (await ownerDb.execute(
    sql`select event, details from platform.tenant_lifecycle_events where tenant_id = ${tenantId}::uuid order by created_at, event`,
  )) as unknown as Array<{ event: string; details: Record<string, unknown> }>;
  return rows;
}

/** テナントを作り、名前・状態を決める(過去のデモ用テナントのふり)。 */
async function makeTenant(slug: string, name: string, status: 'active' | 'suspended' | 'provisioning') {
  const { tenant } = await provisionTenant(provisioningDeps, { slug, name });
  createdTenantIds.add(tenant.id);
  await ownerDb.execute(sql`update platform.tenants set status = ${status} where id = ${tenant.id}::uuid`);
  return tenant;
}

const demoAdmin = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
if (!demoAdmin) throw new Error('DEMO_ACCOUNTS に admin 役割がありません');
const loginDemoAdmin = (tenantSlug: string) =>
  login(container, {
    tenantSlug,
    email: demoAdmin.email,
    password: DEMO_PASSWORD,
    meta: { ip: '203.0.113.5' },
  });

describe('resetDemoTenant(実DB)', () => {
  it('1回目でテナント・スタッフ・顧客・日報・出勤簿・領収書を作り、2回目は前のテナントを日付付きで停止して残し、新しく作る', async () => {
    const now = new Date();
    // 前回の作り直しが途中で止まり、作成中のまま残ったテナント(残さずに消す)
    const incomplete = await makeTenant(slug, DEMO_TENANT_NAME, 'provisioning');

    const first = await resetDemoTenant(ownerDb, container, slug, RETENTION, now);
    createdTenantIds.add(first.tenantId);
    expect(first.archived).toBeNull();
    expect(first.discardedIncomplete).toBe(true);
    expect(await tenantRow(incomplete.id)).toBeNull();
    expect(await tenantRow(first.tenantId)).toMatchObject({ slug, status: 'active' });
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

    // 今日・明日の予定を予約として入れている(SCHEDULE_PROVIDER=database の予定タブ。Google カレンダーは要らない)。
    // 出勤簿と同じ visitPlan.ts の予定なので、件数・時間帯が一致する
    const staffRecord = await container.uow.run(first.tenantId, (r) =>
      r.staff.findByLoginEmail(normalizeEmailForIndex(staffAccount.email)),
    );
    if (!staffRecord) throw new Error('デモ用スタッフが見つかりません');
    const schedule = new DatabaseSchedulePort({
      uow: container.uow,
      directory: createScheduleDirectory({ uow: container.uow }),
    });
    const tomorrow = toJstDateIso(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    let expectedReservations = 0;
    for (const date of [toJstDateIso(now), tomorrow]) {
      const planned = planVisitsForDate(date, staffRecord.displayName, areaFigureIndexes('staff'));
      const result = await schedule.getScheduleWithRoute(
        { staffId: staffRecord.id, staffName: staffRecord.displayName },
        date,
        false,
        { tenantId: first.tenantId, fresh: true },
      );
      expect(result.appointments?.map((a) => [a.startTime, a.endTime])).toEqual(
        planned.map((v) => [v.start, v.end]),
      );
      expect(result.appointments?.map((a) => a.customerId)).toEqual(
        planned.map((v) => DEMO_FIGURES[v.figureIndex]?.externalId),
      );
      // 顧客の緯度経度から見積もった訪問の間の距離が入る(2件目以降)
      if (planned.length > 1) expect(result.appointments?.[1]?.moveKm).not.toBe('');
      // デモのスタッフには自宅の緯度経度も入れるので、出勤・退勤の区間も見積もる(反映で出勤簿の距離が空欄にならない)
      expect(result.appointments?.[0]?.attendanceKm).not.toBe('');
      expect(result.appointments?.at(-1)?.leavingKm).not.toBe('');
    }
    for (const account of DEMO_ACCOUNTS) {
      const name = account.name;
      for (const date of [toJstDateIso(now), tomorrow]) {
        expectedReservations += planVisitsForDate(date, name, areaFigureIndexes(account.role)).length;
      }
    }
    expect(first.summary.reservationCount).toBe(expectedReservations);

    // 運用担当者のカレンダーの設定は作り直しでも引き継ぐ
    const calendars = new DrizzleTenantCalendarSettingsStore(ownerDb);
    const settings = {
      sharedCalendars: [{ calendarId: 'demo-shared@group.calendar.google.com', ownerName: '予約' }],
      allowedStaffCalendars: [],
    };
    await calendars.set(first.tenantId, settings);
    // 管理画面で保存した Gemini の API キーも引き継ぐ(新しいテナントで封をし直す)
    const geminiKey = 'AIza-demo-reset-carry-over';
    const sealed = await container.secretBox.seal(first.tenantId, 'gemini_api_key', geminiKey);
    await container.uow.run(first.tenantId, (r) => r.secrets.put('gemini_api_key', sealed, null));
    // 管理画面で編集した AI プロンプトも引き継ぐ
    const promptDefinition = AI_PROMPT_DEFINITIONS[0];
    if (!promptDefinition) throw new Error('AI_PROMPT_DEFINITIONS が空です');
    const promptBody = `${promptDefinition.defaultBody}\n(デモの引き継ぎテスト)`;
    const firstAdmin = await container.uow.run(first.tenantId, (r) =>
      r.staff.findByLoginEmail(normalizeEmailForIndex(demoAdmin.email)),
    );
    if (!firstAdmin) throw new Error('1回目のデモの管理者が見つかりません');
    await container.uow.run(first.tenantId, (r) =>
      r.aiPrompts.save({
        key: promptDefinition.key,
        kind: promptDefinition.kind,
        body: promptBody,
        updatedBy: firstAdmin.id,
      }),
    );

    // 訪問者のログインと通知の購読(作り直しで消える)
    const firstLogin = await loginDemoAdmin(slug);
    if (!firstLogin.ok) throw new Error('1回目のデモにログインできません');
    await container.uow.run(first.tenantId, (r) =>
      r.pushSubscriptions.upsert({
        id: newId(),
        staffId: firstLogin.staff.id,
        endpoint: `https://push.example.com/${slug}`,
        p256dh: 'p256dh',
        auth: 'auth',
        userAgent: null,
      }),
    );
    expect(await countIn(first.tenantId, 'sessions')).toBe(1);
    const firstCareRecords = await countIn(first.tenantId, 'care_records');
    expect(firstCareRecords).toBeGreaterThan(0);

    const deleteSpy = vi.spyOn(container.storage, 'delete');
    const later = new Date(now.getTime() + DAY_MS);
    const second = await resetDemoTenant(ownerDb, container, slug, RETENTION, later);
    createdTenantIds.add(second.tenantId);
    // 前のテナントは消さないので、領収書の画像も消さない
    expect(deleteSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
    expect(second.tenantId).not.toBe(first.tenantId);
    expect(second.discardedIncomplete).toBe(false);
    // 作り直しの日(later)の前日 = now の日付を slug に付けて残す
    const archivedSlug = `${slug}-${addDays(zonedBusinessDate(later, 'Asia/Tokyo'), -1).replaceAll('-', '')}`;
    expect(archivedSlug).toBe(`${slug}-${zonedBusinessDate(now, 'Asia/Tokyo').replaceAll('-', '')}`);
    expect(second.archived).toEqual({ tenantId: first.tenantId, slug: archivedSlug });
    expect(await tenantRow(first.tenantId)).toEqual({
      slug: archivedSlug,
      status: 'suspended',
      name: DEMO_TENANT_NAME,
    });
    expect(await tenantRow(second.tenantId)).toMatchObject({ slug, status: 'active' });
    // 残したテナントのデータはそのまま、セッション・通知の購読は消えている
    expect(await countIn(first.tenantId, 'care_records')).toBe(firstCareRecords);
    expect(await countIn(first.tenantId, 'sessions')).toBe(0);
    expect(await countIn(first.tenantId, 'push_subscriptions')).toBe(0);
    expect(await authenticateSession(container, firstLogin.sessionCookieValue)).toMatchObject({ ok: false });
    // 残したテナントにはログインできない(停止中)。新しいテナントにはログインできる
    expect(await loginDemoAdmin(archivedSlug)).toEqual({ ok: false, reason: 'tenant_suspended' });
    expect((await loginDemoAdmin(slug)).ok).toBe(true);
    expect(await lifecycleEvents(first.tenantId)).toContainEqual({
      event: 'suspended',
      details: { by: 'demo:reset', reason: 'demo_archive', previousSlug: slug, archivedSlug },
    });

    // 同じ日にもう一度流すと、同じ日付の slug に連番を付けて残す
    const third = await resetDemoTenant(ownerDb, container, slug, RETENTION, later);
    createdTenantIds.add(third.tenantId);
    expect(third.archived).toEqual({ tenantId: second.tenantId, slug: `${archivedSlug}-2` });
    expect(await tenantRow(first.tenantId)).toMatchObject({ slug: archivedSlug, status: 'suspended' });
    expect(second.summary.staffCount).toBe(3);
    expect(second.summary.customerCount).toBe(20);
    expect(second.summary.dailyReportCount).toBeGreaterThan(0);
    expect(second.summary.attendanceDayCount).toBeGreaterThan(0);
    expect(second.summary.generatedThrough).toBe(toJstDateIso(later));
    expect(await calendars.get(second.tenantId)).toEqual(settings);
    expect(await readTenantSecret(container, second.tenantId, 'gemini_api_key')).toBe(geminiKey);
    expect(await calendars.get(third.tenantId)).toEqual(settings);
    expect(await readTenantSecret(container, third.tenantId, 'gemini_api_key')).toBe(geminiKey);
    for (const id of [second.tenantId, third.tenantId]) {
      const kept = await container.uow.run(id, (r) => r.aiPrompts.findByKey(promptDefinition.key));
      expect(kept?.body).toBe(promptBody);
    }
  }, 240_000);

  it('demo:reset が作ったものでないテナント(名前が違う)は残しも消しもしない', async () => {
    const otherSlug = `not-demo-it-${randomBytes(4).toString('hex')}`;
    const other = await makeTenant(otherSlug, '本物の法人', 'active');
    await expect(resetDemoTenant(ownerDb, container, otherSlug, RETENTION)).rejects.toThrow('消しません');
    expect(await tenantRow(other.id)).toMatchObject({ slug: otherSlug, status: 'active' });
  });

  it('保存期間を過ぎた過去のデモ用テナントだけを消す(slug・名前・停止中の3つが合うもの)', async () => {
    const base = `demo-purge-it-${randomBytes(4).toString('hex')}`;
    const now = new Date();
    const today = zonedBusinessDate(now, 'Asia/Tokyo');
    const compact = (date: string) => date.replaceAll('-', '');
    const old = compact(addDays(today, -31));
    const kept = compact(addDays(today, -30));
    const expired = await makeTenant(`${base}-${old}`, DEMO_TENANT_NAME, 'suspended');
    const expiredSeq = await makeTenant(`${base}-${old}-2`, DEMO_TENANT_NAME, 'suspended');
    const untouched = [
      // 保存期間の中
      await makeTenant(`${base}-${kept}`, DEMO_TENANT_NAME, 'suspended'),
      // 名前が違う
      await makeTenant(`${base}-${old}-3`, '本物の法人', 'suspended'),
      // 停止中でない
      await makeTenant(`${base}-${old}-4`, DEMO_TENANT_NAME, 'active'),
      // slug の形が違う
      await makeTenant(`${base}-x-${old}`, DEMO_TENANT_NAME, 'suspended'),
      await makeTenant(`${base}x-${old}`, DEMO_TENANT_NAME, 'suspended'),
    ];
    // 消すテナントの画像は保存先から消す
    const storageKey = `receipts/${expired.id}/purge-it.jpg`;
    await container.storage.put(storageKey, 'image/jpeg', new Uint8Array([1]));
    await container.uow.run(expired.id, (r) =>
      r.storedFiles.insert({
        id: newId(),
        storageKey,
        contentType: 'image/jpeg',
        byteSize: 1,
        sha256: new Uint8Array(32),
        purpose: 'receipt_image',
        createdBy: null,
      }),
    );
    const deleteSpy = vi.spyOn(container.storage, 'delete');

    const result = await purgeExpiredDemoArchives(ownerDb, container, base, now, 30);
    expect(result.failures).toEqual([]);
    expect(result.purged.sort()).toEqual([`${base}-${old}`, `${base}-${old}-2`]);
    expect(deleteSpy).toHaveBeenCalledWith(storageKey);
    deleteSpy.mockRestore();
    expect(await tenantRow(expired.id)).toBeNull();
    expect(await tenantRow(expiredSeq.id)).toBeNull();
    expect((await lifecycleEvents(expired.id)).map((e) => e.event)).toEqual(
      expect.arrayContaining(['terminated', 'purged']),
    );
    for (const tenant of untouched) {
      expect(await tenantRow(tenant.id)).toMatchObject({ slug: tenant.slug });
    }
    // もう一度流しても何も消さない
    expect(await purgeExpiredDemoArchives(ownerDb, container, base, now, 30)).toEqual({
      purged: [],
      failures: [],
    });
  });

  it('期限切れのデモの画像を消せなければ、そのテナントは停止のまま残して purgeFailures に出し、作り直しは終える', async () => {
    const failSlug = `demo-fail-it-${randomBytes(4).toString('hex')}`;
    const now = new Date();
    const old = addDays(zonedBusinessDate(now, 'Asia/Tokyo'), -31).replaceAll('-', '');
    const expiredSlug = `${failSlug}-${old}`;
    const expired = await makeTenant(expiredSlug, DEMO_TENANT_NAME, 'suspended');
    const storageKey = `receipts/${expired.id}/purge-fail-it.jpg`;
    await container.storage.put(storageKey, 'image/jpeg', new Uint8Array([1]));
    await container.uow.run(expired.id, (r) =>
      r.storedFiles.insert({
        id: newId(),
        storageKey,
        contentType: 'image/jpeg',
        byteSize: 1,
        sha256: new Uint8Array(32),
        purpose: 'receipt_image',
        createdBy: null,
      }),
    );
    const deleteSpy = vi
      .spyOn(container.storage, 'delete')
      .mockRejectedValue(new Error('storage unavailable'));
    try {
      const result = await resetDemoTenant(ownerDb, container, failSlug, RETENTION, now);
      createdTenantIds.add(result.tenantId);
      expect(deleteSpy).toHaveBeenCalledWith(storageKey);
      expect(result.purged).toEqual([]);
      expect(result.purgeFailures).toEqual([{ slug: expiredSlug, error: expect.any(String) }]);
      // 消せなかったテナントは停止のまま残る(次回の作り直しでもう一度消す)
      expect(await tenantRow(expired.id)).toEqual({
        slug: expiredSlug,
        status: 'suspended',
        name: DEMO_TENANT_NAME,
      });
      // 新しいデモは使える状態で終わる
      expect(await tenantRow(result.tenantId)).toMatchObject({ slug: failSlug, status: 'active' });
    } finally {
      deleteSpy.mockRestore();
      await container.storage.delete(storageKey).catch(() => undefined);
    }
  }, 240_000);
});
