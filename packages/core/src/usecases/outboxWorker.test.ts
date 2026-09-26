import { beforeEach, describe, expect, it } from 'vitest';
import { PermanentOutboxError } from '../domain';
import { processNextOutboxMessage } from './outboxWorker';
import { cancelReceipt } from './receiptCancel';
import { uploadReceipts } from './receipts';
import { saveDailyReport } from './reports';
import type { Actor } from './requestMeta';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('outbox ワーカー', () => {
  let ctx: TestContext;
  let staff: Actor;
  let customerId: string;

  const saveReport = () =>
    saveDailyReport(ctx.deps, staff, {
      customerId,
      reportDate: '2026-09-25',
      startTime: '09:00',
      endTime: '12:00',
      inputText: 'メモ',
      internalText: '社内',
      customerText: '保護者',
      riskRating: 1,
      esRating: 4,
    });

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    customerId = await ctx.addCustomer('佐藤 花子', 'R-001');
  });

  it('日報のミラーは DB から読み直し、RESERVA の顧客IDで送る', async () => {
    const saved = await saveReport();
    expect(await ctx.drain()).toMatchObject({ done: 1 });
    expect(ctx.sender.dailyReports).toEqual([
      expect.objectContaining({
        reportId: saved.id,
        staffName: '山田 太郎',
        customerId: 'R-001',
        customerName: '佐藤 花子',
        inputText: 'メモ',
        timestampJst: '2026/09/25 09:00:00',
      }),
    ]);
    expect(ctx.data().outbox[0]).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('失敗は指数バックオフで再試行し、上限回数で dead にして ERROR ログを残す', async () => {
    await saveReport();
    ctx.sender.failures = 100;
    expect(await processNextOutboxMessage(ctx.deps)).toBe('retried');
    const message = ctx.data().outbox[0];
    expect(message?.status).toBe('pending');
    expect(message?.availableAt.getTime()).toBeGreaterThan(ctx.clock.now.getTime());
    // 取り出せるのは available_at を過ぎてから
    expect(await processNextOutboxMessage(ctx.deps)).toBe('idle');
    if (message) message.maxAttempts = 2;
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 24 * 60 * 60 * 1000);
    expect(await processNextOutboxMessage(ctx.deps)).toBe('failed');
    expect(ctx.data().outbox[0]?.status).toBe('dead');
    expect(ctx.appLog.byAction('outbox.message_failed')[0]).toMatchObject({ level: 'ERROR' });
  });

  it('リースの切れた processing は別のワーカーが取り直す', async () => {
    await saveReport();
    const message = ctx.data().outbox[0];
    if (message)
      Object.assign(message, { status: 'processing', lockedUntil: new Date(ctx.clock.now.getTime() - 1) });
    expect(await processNextOutboxMessage(ctx.deps)).toBe('done');
  });

  it('処理中にリースが切れて別のワーカーが取り直したら、遅れて終わった処理は結果を書かない(lease_lost)', async () => {
    await saveReport();
    const message = ctx.data().outbox[0];
    // 送信中に別のワーカーがリース切れの行を取り直した状況を作る
    ctx.sender.onSend = () => {
      if (message) Object.assign(message, { lockedBy: 'other-worker', attempts: message.attempts + 1 });
    };
    expect(await processNextOutboxMessage(ctx.deps)).toBe('lease_lost');
    expect(message).toMatchObject({ status: 'processing', lockedBy: 'other-worker' });
    expect(ctx.appLog.byAction('outbox.lease_lost')).toHaveLength(1);
  });

  it('処理中のままリースが切れて試行回数の上限に達したものは取り直さず dead(ERROR ログ)', async () => {
    await saveReport();
    const message = ctx.data().outbox[0];
    if (message) {
      Object.assign(message, {
        status: 'processing',
        attempts: message.maxAttempts,
        lockedBy: 'crashed-worker',
        lockedUntil: new Date(ctx.clock.now.getTime() - 1),
      });
    }
    expect(await processNextOutboxMessage(ctx.deps)).toBe('idle');
    expect(message?.status).toBe('dead');
    expect(ctx.sender.dailyReports).toHaveLength(0);
    expect(ctx.appLog.byAction('outbox.message_failed')[0]).toMatchObject({ level: 'ERROR' });
  });

  it('MIRROR が無効ならミラーのトピックは送らずに完了にする(メールは送る)', async () => {
    await saveReport();
    ctx.deps.mirrorTenantSlug = null;
    expect(await ctx.drain()).toMatchObject({ skipped: 1, done: 0 });
    expect(ctx.sender.dailyReports).toHaveLength(0);
    expect(ctx.data().outbox[0]?.status).toBe('done');
  });

  it('ミラーするテナント(GAS_BRIDGE_TENANT)以外のミラーは送らずに完了にし、WARN を残す(メールは送る)', async () => {
    await saveReport();
    ctx.deps.mirrorTenantSlug = 'cutest';
    expect(await ctx.drain()).toMatchObject({ skipped: 1, done: 0 });
    expect(ctx.sender.dailyReports).toHaveLength(0);
    expect(ctx.appLog.byAction('outbox.mirror_other_tenant_skipped')).toEqual([
      expect.objectContaining({
        tenantId: ctx.tenantId,
        level: 'WARN',
        details: expect.objectContaining({ topic: 'mirror.care_record', mirrorTenant: 'cutest' }),
      }),
    ]);
  });

  it('UoW はミラーするテナントの時だけミラーのトピックを積む(別のテナントは積まない)', async () => {
    ctx.db.outboxPolicy = { mirrorTenantSlug: 'cutest', pushEnabled: true };
    await saveReport();
    expect(ctx.data().outbox.map((m) => m.topic)).toEqual([]);
    ctx.db.outboxPolicy = { mirrorTenantSlug: ctx.tenant.slug, pushEnabled: true };
    await saveReport();
    expect(ctx.data().outbox.map((m) => m.topic)).toEqual(['mirror.care_record']);
  });

  it('領収書の画像が無ければ送らずに WARN を残して完了にする', async () => {
    await uploadReceipts(ctx.deps, staff, {
      customerId,
      images: [{ data: JPEG, amount: '100', storeName: '店' }],
      fallbackTimestamp: '2026/09/25 10:00:00',
      handoffText: '',
    });
    ctx.storage.files.clear();
    expect(await ctx.drain()).toMatchObject({ done: 1 });
    expect(ctx.sender.receipts).toHaveLength(0);
    expect(ctx.appLog.byAction('mirror.receipt.image_missing')).toHaveLength(1);
  });

  it('写す前に取消された領収書は送らずに完了にする(残りの領収書は送る)', async () => {
    await uploadReceipts(ctx.deps, staff, {
      customerId,
      images: [
        { data: JPEG, amount: '100', storeName: '店A' },
        { data: JPEG, amount: '200', storeName: '店B' },
      ],
      fallbackTimestamp: '2026/09/25 10:00:00',
      handoffText: '',
    });
    const target = ctx.data().receipts.find((r) => r.storeName === '店A');
    if (!target) throw new Error('登録できませんでした');
    await cancelReceipt(ctx.deps, staff, { receiptId: target.id, rowVersion: target.rowVersion });
    expect(await ctx.drain()).toMatchObject({ done: 2 });
    expect(ctx.sender.receipts.map((r) => r.storeName)).toEqual(['店B']);
    expect(ctx.data().outbox.every((m) => m.status === 'done')).toBe(true);
  });

  it('領収書のミラーは申し送りを束の最初の1枚にだけ付ける', async () => {
    await uploadReceipts(ctx.deps, staff, {
      customerId,
      images: [
        { data: JPEG, amount: '100', storeName: '店A' },
        { data: JPEG, amount: '200', storeName: '店B' },
      ],
      fallbackTimestamp: '2026/09/25 10:00:00',
      handoffText: '申し送り',
    });
    await ctx.drain();
    expect(ctx.sender.receipts.map((r) => [r.storeName, r.handoffText])).toEqual([
      ['店A', '申し送り'],
      ['店B', ''],
    ]);
  });

  it('PermanentOutboxError は再試行せずに failed にする', async () => {
    await saveReport();
    const original = ctx.sender.sendDailyReport.bind(ctx.sender);
    ctx.sender.sendDailyReport = async () => {
      throw new PermanentOutboxError('送れない内容');
    };
    expect(await processNextOutboxMessage(ctx.deps)).toBe('failed');
    expect(ctx.data().outbox[0]?.status).toBe('failed');
    ctx.sender.sendDailyReport = original;
  });
});
