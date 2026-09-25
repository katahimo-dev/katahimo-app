import { describe, expect, it } from 'vitest';
import type { RateLimitBucket, RateLimitRule } from './rateLimit';
import { consumeRateLimit, peekRateLimit } from './rateLimit';

const t0 = new Date('2026-09-25T00:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const MIN = 60_000;

function consumeTimes(rule: RateLimitRule, times: number, now: Date, start: RateLimitBucket | null = null) {
  let bucket = start;
  const decisions = [];
  for (let i = 0; i < times; i++) {
    const r = consumeRateLimit(bucket, rule, now);
    bucket = r.bucket;
    decisions.push(r.decision);
  }
  return { bucket, decisions };
}

describe('レート制限(クォータ: ロックなし)', () => {
  const quota: RateLimitRule = { name: 'q', limit: 3, windowMs: 60 * MIN };

  it('上限回数までは許可し、超えた回は窓が明けるまで拒否する', () => {
    const { bucket, decisions } = consumeTimes(quota, 4, t0);
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions[3]?.retryAfterMs).toBe(60 * MIN);
    expect(peekRateLimit(bucket, quota, at(30 * MIN)).allowed).toBe(false);
    // 窓が明けたら1から数え直す
    const next = consumeRateLimit(bucket, quota, at(60 * MIN));
    expect(next.decision).toMatchObject({ allowed: true, count: 1 });
  });

  it('ロックしない規則では lockStarted にならない', () => {
    const { decisions } = consumeTimes(quota, 5, t0);
    expect(decisions.some((d) => d.lockStarted)).toBe(false);
  });
});

describe('レート制限(失敗回数+一時ロック)', () => {
  const lockRule: RateLimitRule = { name: 'l', limit: 3, windowMs: 15 * MIN, lockMs: 30 * MIN };

  it('上限に達した回でロックが始まり、ロック中は窓が明けても拒否し続ける', () => {
    const { bucket, decisions } = consumeTimes(lockRule, 3, t0);
    expect(decisions.map((d) => d.lockStarted)).toEqual([false, false, true]);
    expect(peekRateLimit(bucket, lockRule, at(1 * MIN))).toMatchObject({
      allowed: false,
      retryAfterMs: 29 * MIN,
    });
    // 窓(15分)は明けてもロック(30分)中は拒否
    expect(peekRateLimit(bucket, lockRule, at(20 * MIN)).allowed).toBe(false);
    const during = consumeRateLimit(bucket, lockRule, at(20 * MIN));
    expect(during.decision.allowed).toBe(false);
    expect(during.decision.lockStarted).toBe(false);
    // ロックの延長はしない
    expect(during.bucket.blockedUntil).toEqual(at(30 * MIN));
  });

  it('ロックが解けたら数え直す', () => {
    const { bucket } = consumeTimes(lockRule, 3, t0);
    expect(peekRateLimit(bucket, lockRule, at(30 * MIN))).toMatchObject({ allowed: true, count: 0 });
    const after = consumeRateLimit(bucket, lockRule, at(30 * MIN));
    expect(after.decision).toMatchObject({ allowed: true, count: 1, lockStarted: false });
    expect(after.bucket.blockedUntil).toBeNull();
  });

  it('窓の中で上限未満なら peek は許可する', () => {
    const { bucket } = consumeTimes(lockRule, 2, t0);
    expect(peekRateLimit(bucket, lockRule, at(1 * MIN))).toMatchObject({ allowed: true, count: 2 });
    expect(peekRateLimit(null, lockRule, t0)).toMatchObject({ allowed: true, count: 0 });
  });
});
