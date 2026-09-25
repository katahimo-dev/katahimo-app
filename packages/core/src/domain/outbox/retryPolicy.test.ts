import { describe, expect, it } from 'vitest';
import { decideOnFailure, retryDelayMs } from './retryPolicy';

const policy = { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 5000 };

describe('outboxの再試行方針', () => {
  it('待ち時間は失敗のたびに倍になり、上限で頭打ちになる', () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs(n, policy))).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it('上限回数に達するまでは再試行を予約し、達したら諦める', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    expect(decideOnFailure(1, now, policy)).toEqual({
      kind: 'retry',
      delayMs: 1000,
      nextAttemptAt: new Date('2026-09-25T00:00:01Z'),
    });
    expect(decideOnFailure(3, now, policy).kind).toBe('retry');
    expect(decideOnFailure(4, now, policy)).toEqual({ kind: 'give_up' });
  });
});
