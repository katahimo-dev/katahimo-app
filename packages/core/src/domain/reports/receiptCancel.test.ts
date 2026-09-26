import type { StaffRole } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { zonedBusinessDate } from '../time/zoned';
import { type ReceiptCancelRefusal, receiptCancelRefusal } from './receiptCancel';

const check = (receiptDate: string, today: string, role: StaffRole = 'staff') =>
  receiptCancelRefusal({ receiptDate, today, role });

describe('receiptCancelRefusal(スタッフ・コーディネーター)', () => {
  const cases: [string, string, ReceiptCancelRefusal | null][] = [
    // 領収書の日付 D, 今日, 結果
    ['2026-09-10', '2026-09-10', null], // D+0
    ['2026-09-10', '2026-09-11', null], // D+1
    ['2026-09-10', '2026-09-12', null], // D+2
    ['2026-09-10', '2026-09-13', 'deadline_passed'], // D+3
    ['2026-09-10', '2026-09-09', null], // 未来の日付の領収書(同じ月)
    // 月の最終日の前後(9月は30日まで)
    ['2026-09-28', '2026-09-29', null],
    ['2026-09-28', '2026-09-30', 'month_end'], // D+2 でも最終日は不可
    ['2026-09-30', '2026-09-30', 'month_end'], // 最終日の領収書は取消せる日が無い
    ['2026-09-30', '2026-10-01', 'other_month'], // 月をまたぐ
    ['2026-09-29', '2026-10-01', 'other_month'],
    // 31日の月: 29日の領収書は29日・30日だけ
    ['2026-10-29', '2026-10-29', null],
    ['2026-10-29', '2026-10-30', null],
    ['2026-10-29', '2026-10-31', 'month_end'],
    // 2月(平年は28日、うるう年は29日まで)
    ['2026-02-26', '2026-02-27', null],
    ['2026-02-26', '2026-02-28', 'month_end'],
    ['2028-02-26', '2028-02-28', null],
    ['2028-02-27', '2028-02-29', 'month_end'],
    ['2028-02-28', '2028-03-01', 'other_month'],
    // 年をまたぐ
    ['2026-12-30', '2027-01-01', 'other_month'],
  ];
  it.each(cases)('D=%s 今日=%s → %s', (receiptDate, today, expected) => {
    expect(check(receiptDate, today, 'staff')).toBe(expected);
    // コーディネーターも同じ規則(管理者だけが期限・最終日の制限を受けない)
    expect(check(receiptDate, today, 'coordinator')).toBe(expected);
  });
});

describe('receiptCancelRefusal(管理者)', () => {
  const cases: [string, string, ReceiptCancelRefusal | null][] = [
    ['2026-09-10', '2026-09-10', null],
    ['2026-09-10', '2026-09-15', null], // D+5 でも同じ月なら取消せる
    ['2026-09-01', '2026-09-30', null], // 月の最終日も取消せる
    ['2026-09-30', '2026-09-30', null],
    ['2026-09-30', '2026-10-01', 'other_month'], // 前の月の分は取消せない
    ['2026-08-31', '2026-09-01', 'other_month'],
    ['2028-02-29', '2028-02-29', null],
    ['2026-10-01', '2026-09-30', 'other_month'], // 次の月の日付の領収書も今の月では扱わない
  ];
  it.each(cases)('D=%s 今日=%s → %s', (receiptDate, today, expected) => {
    expect(check(receiptDate, today, 'admin')).toBe(expected);
  });
});

describe('テナントのタイムゾーンの暦日で判定する', () => {
  const tz = 'Asia/Tokyo';
  it('日本時間の月末の深夜(UTC では前日)は最終日として扱う', () => {
    // 2026-09-30 23:59 JST = 2026-09-30T14:59Z
    const today = zonedBusinessDate(new Date('2026-09-30T14:59:00Z'), tz);
    expect(today).toBe('2026-09-30');
    expect(check('2026-09-29', today)).toBe('month_end');
    expect(check('2026-09-29', today, 'admin')).toBeNull();
  });
  it('日本時間の翌月1日 0:00 (UTC では前月の最終日)は翌月として扱う', () => {
    // 2026-10-01 00:00 JST = 2026-09-30T15:00Z(UTC ではまだ9月30日)
    const today = zonedBusinessDate(new Date('2026-09-30T15:00:00Z'), tz);
    expect(today).toBe('2026-10-01');
    // 領収書日時 2026-09-29 23:30 JST = 2026-09-29T14:30Z
    const receiptDate = zonedBusinessDate(new Date('2026-09-29T14:30:00Z'), tz);
    expect(check(receiptDate, today, 'admin')).toBe('other_month');
  });
  it('領収書日時の暦日もテナントのタイムゾーン(日本時間の0:30はUTCの前日)', () => {
    // 2026-09-11 00:30 JST = 2026-09-10T15:30Z → 基準の日は 9/11
    const receiptDate = zonedBusinessDate(new Date('2026-09-10T15:30:00Z'), tz);
    expect(receiptDate).toBe('2026-09-11');
    expect(check(receiptDate, '2026-09-13')).toBeNull();
    expect(check(receiptDate, '2026-09-14')).toBe('deadline_passed');
  });
});
