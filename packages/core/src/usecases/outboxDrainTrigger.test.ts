import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxDrainTriggerPort, OutboxMessageInput } from '../ports/outbox';
import {
  OutboxDrainNotifier,
  type OutboxDrainTriggerFailure,
  withOutboxDrainTrigger,
} from './outboxDrainTrigger';
import { saveDailyReport } from './reports';
import { createTestContext } from './testContext';

class FakeDrainTrigger implements OutboxDrainTriggerPort {
  requests = 0;
  failWith: Error | null = null;
  async requestDrain(): Promise<void> {
    this.requests++;
    if (this.failWith) throw this.failWith;
  }
}

const message = (id: string): OutboxMessageInput => ({
  topic: 'mail.password_reset',
  aggregateType: 'password_reset_code',
  aggregateId: id,
  dedupeKey: `mail.password_reset:${id}:1`,
});

describe('outbox-drain の起動の依頼', () => {
  let trigger: FakeDrainTrigger;
  let warnings: OutboxDrainTriggerFailure[];
  let notifier: OutboxDrainNotifier;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T03:00:00Z'));
    trigger = new FakeDrainTrigger();
    warnings = [];
    notifier = new OutboxDrainNotifier({ trigger, warn: (w) => warnings.push(w), cooldownMs: 10_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('outbox に積んだ run のコミットの後にだけ頼む', async () => {
    const ctx = createTestContext();
    const uow = withOutboxDrainTrigger(ctx.uow, notifier);
    let requestsInsideWork = -1;
    await uow.run(ctx.tenantId, async (r) => {
      await r.outbox.enqueue(message('a'));
      requestsInsideWork = trigger.requests;
    });
    // トランザクションの中では頼まず、コミットの後(run から戻る前)に頼む
    expect(requestsInsideWork).toBe(0);
    expect(trigger.requests).toBe(1);
    expect(ctx.data().outbox).toHaveLength(1);
  });

  it('積まなかった run・積み済みの重複だけの run・ロールバックした run では頼まない', async () => {
    const ctx = createTestContext();
    const uow = withOutboxDrainTrigger(ctx.uow, notifier);
    await ctx.uow.run(ctx.tenantId, (r) => r.outbox.enqueue(message('a')));

    await uow.run(ctx.tenantId, async (r) => r.staff.findById('00000000-0000-7000-8000-000000000000'));
    expect(await uow.run(ctx.tenantId, (r) => r.outbox.enqueue(message('a')))).toBe(false);
    await expect(
      uow.run(ctx.tenantId, async (r) => {
        await r.outbox.enqueue(message('b'));
        throw new Error('保存に失敗');
      }),
    ).rejects.toThrow('保存に失敗');

    expect(trigger.requests).toBe(0);
    expect(ctx.data().outbox).toHaveLength(1);
  });

  it('usecase(日報の保存 → mirror.care_record)の経路でも頼み、latestPayload はそのまま使える', async () => {
    const ctx = createTestContext();
    const deps = { ...ctx.deps, uow: withOutboxDrainTrigger(ctx.uow, notifier) };
    const { actor } = await ctx.addStaff('山田 太郎', 'taro@example.com');
    const customerId = await ctx.addCustomer('佐藤 花子', 'R-001');
    await saveDailyReport(deps, actor, {
      customerId,
      reportDate: '2026-09-25',
      startTime: '09:00',
      endTime: '12:00',
      inputText: 'メモ',
      internalText: '社内',
      customerText: '保護者',
      riskRating: 4,
      esRating: 4,
    });
    expect(trigger.requests).toBe(1);
    expect(ctx.data().outbox.map((m) => m.topic)).toContain('mirror.care_record');
    const latest = await deps.uow.run(ctx.tenantId, (r) =>
      r.outbox.latestPayload('mirror.care_record', ctx.data().outbox[0]?.aggregateId ?? ''),
    );
    expect(latest).not.toBeNull();
  });

  it('依頼の失敗は例外にせず WARN outbox.drain_trigger_failed を書く(積んだものはコミットされたまま)', async () => {
    const ctx = createTestContext();
    const uow = withOutboxDrainTrigger(ctx.uow, notifier);
    trigger.failWith = new Error('HTTP 403');
    await expect(uow.run(ctx.tenantId, (r) => r.outbox.enqueue(message('a')))).resolves.toBe(true);
    expect(ctx.data().outbox).toHaveLength(1);
    expect(warnings).toEqual([
      expect.objectContaining({ action: 'outbox.drain_trigger_failed', error: 'HTTP 403' }),
    ]);
  });

  it('間隔の中の依頼は1回にまとめ、間隔が明けたときに1回だけ頼む', async () => {
    await notifier.notify();
    expect(trigger.requests).toBe(1);

    vi.advanceTimersByTime(3_000);
    await notifier.notify();
    vi.advanceTimersByTime(3_000);
    await notifier.notify();
    // 間隔の中ではまだ頼まない
    expect(trigger.requests).toBe(1);

    // 最初の依頼から10秒で、まとめた1回を頼む
    await vi.advanceTimersByTimeAsync(4_000);
    expect(trigger.requests).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(trigger.requests).toBe(2);

    // 間隔の外ならすぐに頼む
    await notifier.notify();
    expect(trigger.requests).toBe(3);
  });

  it('まとめた1回の依頼の失敗も WARN にする', async () => {
    await notifier.notify();
    trigger.failWith = new Error('timeout');
    await notifier.notify();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(trigger.requests).toBe(2);
    expect(warnings).toEqual([
      expect.objectContaining({ action: 'outbox.drain_trigger_failed', error: 'timeout' }),
    ]);
  });
});
