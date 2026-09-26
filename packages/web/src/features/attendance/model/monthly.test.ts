import type { AttendanceMonth } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../lib/memoryStorage.test-helper';
import { CACHE_TTL_MS, monthCacheKey, readCache, weekCacheKey, writeCache } from './cache';
import { buildMonthlyDayCards, monthDayHasContent, receiptRows } from './monthly';

const derived = (worked: number) => ({
  leg1MoveStart: '',
  leg1MoveEnd: '',
  leg1WeatherAdjustedMoveMin: '' as const,
  leg1WaitMin: '' as const,
  leg2MoveStart: '',
  leg2MoveEnd: '',
  leg2WeatherAdjustedMoveMin: '' as const,
  leg2WaitMin: '' as const,
  laborMinutes: worked,
  overtimeMinutes: 0,
  workedMinutes: worked,
  totalMoveMin: 0,
  totalDistanceKm: 0,
  overThresholdCount: worked > 100 ? 1 : 0,
  visitCount: 0,
});

const month = {
  yearMonth: '2026-09',
  staffId: '00000000-0000-4000-8000-000000000001',
  staffName: '佐藤',
  days: [
    {
      businessDate: '2026-09-01',
      rowData: { X: '事務', Y: '10:00', Z: '11:00', C: '田中' },
      derived: derived(120),
    },
    { businessDate: '2026-09-02', rowData: { I: '雨', H: '20' }, derived: derived(0) },
    { businessDate: '2026-09-03', rowData: { AJ: '0', AN: '2' }, derived: derived(0) },
  ],
  totals: {} as AttendanceMonth['totals'],
  receipts: {
    byDay: { '2026-09-09': 540, '2026-09-03': 1280 },
    total: 1820,
    companyPaidByDay: { '2026-09-03': 300 },
    companyPaid: 300,
    customerBillable: 1520,
  },
} satisfies AttendanceMonth;

describe('今月のまとめ', () => {
  it('天候・計画移動時間だけの日は出さない。0より大きい買い物代行は出す', () => {
    expect(month.days.map(monthDayHasContent)).toEqual([true, false, true]);
  });
  it('日のカード: 名前は訪問→事務作業の順、押したときは入っている最初の予定', () => {
    const cards = buildMonthlyDayCards(month, () => '火');
    expect(cards.map((c) => c.date)).toEqual(['2026-09-01', '2026-09-03']);
    expect(cards[0]).toMatchObject({ day: '1', dow: '火', names: '田中・事務', overThresholdCount: 1 });
    expect(cards[0]?.firstSlot?.def.key).toBe('office1');
    expect(cards[1]?.firstSlot).toBeNull();
  });
  it('領収書は日付順(日の合計は会社負担を含み、うち会社負担を添える)', () => {
    expect(receiptRows(month)).toEqual([
      { date: '2026-09-03', amount: 1280, companyPaid: 300 },
      { date: '2026-09-09', amount: 540, companyPaid: 0 },
    ]);
  });
});

describe('2時間キャッシュ', () => {
  it('GAS版と同じキー・形で保存し、2時間を過ぎたら使わない', () => {
    const storage = createMemoryStorage();
    const key = weekCacheKey('管理者 太郎', '2026-09-20');
    expect(key).toBe('pastSchedWeek_管理者太郎_2026-09-20');
    expect(monthCacheKey('x', '2026-09')).toBe('attendanceMonthly_x_2026-09');
    writeCache(key, 'events', [1], 1000, storage);
    expect(JSON.parse(storage.snapshot()[key] as string)).toEqual({ events: [1], ts: 1000 });
    expect(readCache(key, 'events', 1000 + CACHE_TTL_MS, storage)).toEqual({ value: [1], ts: 1000 });
    expect(readCache(key, 'events', 1001 + CACHE_TTL_MS, storage)).toBeNull();
    expect(readCache(key, 'res', 1000, storage)).toBeNull();
  });
});
