import { describe, expect, it } from 'vitest';
import {
  DEMO_RESET_SLUG_MAX_LENGTH,
  demoArchiveDate,
  demoArchiveSlug,
  demoResetTargetProblem,
  isExpiredDemoArchive,
  parseDemoArchiveSlug,
} from './demoReset';

describe('demo:reset の対象の確かめ', () => {
  it('DEMO_TENANT_SLUG と一致する slug だけ受け付ける', () => {
    expect(demoResetTargetProblem('public-demo', 'public-demo')).toBeNull();
    expect(demoResetTargetProblem('cutest', 'public-demo')).toContain('DEMO_TENANT_SLUG');
    expect(demoResetTargetProblem('public-demo', undefined)).toContain('未設定');
    expect(demoResetTargetProblem(undefined, 'public-demo')).toContain('使い方');
  });

  it('開発用シード・e2e の demo は、DEMO_TENANT_SLUG が demo でも断る', () => {
    expect(demoResetTargetProblem('demo', 'demo')).toContain('開発用シード');
  });

  it('日付と連番を付けると slug の上限(63文字)を超える長さの slug は断る', () => {
    const ok = 'a'.repeat(DEMO_RESET_SLUG_MAX_LENGTH);
    expect(demoResetTargetProblem(ok, ok)).toBeNull();
    expect(demoArchiveSlug(ok, '2026-10-01', 999).length).toBeLessThanOrEqual(63);
    const long = 'a'.repeat(DEMO_RESET_SLUG_MAX_LENGTH + 1);
    expect(demoResetTargetProblem(long, long)).toContain(`${DEMO_RESET_SLUG_MAX_LENGTH} 文字まで`);
  });
});

describe('前のデモを残す slug', () => {
  it('作り直しの日(テナントのタイムゾーン)の前日の日付を付ける', () => {
    // 2026-10-02 03:30 JST の作り直し → 10/1 に使われたデモ
    expect(demoArchiveDate(new Date('2026-10-01T18:30:00Z'), 'Asia/Tokyo')).toBe('2026-10-01');
    // UTC ではまだ 10/1 だが JST では 10/2 の 08:59
    expect(demoArchiveDate(new Date('2026-10-01T23:59:00Z'), 'Asia/Tokyo')).toBe('2026-10-01');
    expect(demoArchiveDate(new Date('2026-03-01T00:00:00Z'), 'Asia/Tokyo')).toBe('2026-02-28');
  });

  it('同じ日付が既にあれば連番を付ける', () => {
    expect(demoArchiveSlug('public-demo', '2026-10-01', 1)).toBe('public-demo-20261001');
    expect(demoArchiveSlug('public-demo', '2026-10-01', 2)).toBe('public-demo-20261001-2');
  });

  it('残した slug だけを日付として読み、それ以外は null(消す対象にしない)', () => {
    expect(parseDemoArchiveSlug('public-demo', 'public-demo-20261001')).toBe('2026-10-01');
    expect(parseDemoArchiveSlug('public-demo', 'public-demo-20261001-12')).toBe('2026-10-01');
    for (const other of [
      'public-demo',
      'public-demo-2026100',
      'public-demo-202610011',
      'public-demo-20261301',
      'public-demo-20260230',
      'public-demo-20261001-0',
      'public-demo-20261001-1000',
      'public-demo-20261001-x',
      'public-demo-x-20261001',
      'other-demo-20261001',
      'xpublic-demo-20261001',
      'public-demo-20261001-2-3',
    ]) {
      expect(parseDemoArchiveSlug('public-demo', other)).toBeNull();
    }
  });

  it('保存期間は今日から retentionDays 日前より前の日付を消す(直近の retentionDays 日分を残す)', () => {
    expect(isExpiredDemoArchive('2026-09-02', '2026-10-02', 30)).toBe(false);
    expect(isExpiredDemoArchive('2026-09-01', '2026-10-02', 30)).toBe(true);
    expect(isExpiredDemoArchive('2026-10-01', '2026-10-02', 1)).toBe(false);
    expect(isExpiredDemoArchive('2026-09-30', '2026-10-02', 1)).toBe(true);
  });
});
