import { describe, expect, it } from 'vitest';
import {
  appointmentDurationMinutes,
  buildCalendarSyncPlan,
  buildRowDataFromAppointments,
  type CalendarAppointment,
  isOfficeWorkAppointment,
  mergeOverlappingOfficeAppointments,
  timeRangesOverlap,
} from './calendarSync';

const visit = (
  customerName: string,
  startTime: string,
  endTime: string,
  extra: Partial<CalendarAppointment> = {},
): CalendarAppointment => ({ eventType: 'CUSTOMER APPOINTMENT', customerName, startTime, endTime, ...extra });
const office = (customerName: string, startTime: string, endTime: string): CalendarAppointment => ({
  eventType: 'OFFICE WORK',
  customerName,
  startTime,
  endTime,
});

describe('isOfficeWorkAppointment / appointmentDurationMinutes', () => {
  it('OFFICE WORK と、15分ちょうどの顧客予定は事務作業として扱う', () => {
    expect(isOfficeWorkAppointment(office('研修', '10:00', '12:00'))).toBe(true);
    expect(isOfficeWorkAppointment(visit('佐藤様', '10:00', '10:15'))).toBe(true);
    expect(isOfficeWorkAppointment(visit('佐藤様', '10:00', '10:30'))).toBe(false);
    // イベント([イベント])は15分でも訪問扱い
    expect(isOfficeWorkAppointment({ ...visit('研修', '10:00', '10:15'), eventType: 'EVENT' })).toBe(false);
  });

  it('日付をまたぐ予定は翌日側に足して数える', () => {
    expect(appointmentDurationMinutes('23:50', '00:05')).toBe(15);
    expect(appointmentDurationMinutes('', '10:00')).toBeNull();
  });
});

describe('mergeOverlappingOfficeAppointments', () => {
  it('時間の重なる事務作業を1件にまとめ、開始時刻順に並べる', () => {
    const merged = mergeOverlappingOfficeAppointments([
      office('B', '10:30', '11:30'),
      visit('佐藤様', '09:00', '10:00'),
      office('A', '10:00', '11:00'),
      office('C', '11:30', '12:00'),
    ]);
    expect(merged.map((a) => [a.customerName, a.startTime, a.endTime])).toEqual([
      ['佐藤様', '09:00', '10:00'],
      ['A,B', '10:00', '11:30'],
      // 終了と開始が接しているだけの予定はまとめない
      ['C', '11:30', '12:00'],
    ]);
  });

  it('まとめ済みの予定に再適用しても変わらない', () => {
    const once = mergeOverlappingOfficeAppointments([
      office('A', '10:00', '11:00'),
      office('B', '10:30', '12:00'),
    ]);
    expect(mergeOverlappingOfficeAppointments(once)).toEqual(once);
  });
});

describe('buildRowDataFromAppointments', () => {
  it('訪問は#1〜#3、事務作業は#1〜#2へ入り、#2/#3には直前からの移動時間・距離が入る', () => {
    const row = buildRowDataFromAppointments([
      visit('佐藤様', '09:00', '10:00', { attendanceKm: 5.5 }),
      office('チームmtg', '10:00', '10:30'),
      visit('鈴木様', '11:00', '12:00', { moveMin: 20, moveKm: 7.25 }),
      visit('田中様', '13:00', '14:00', { moveMin: 0, moveKm: 0, leavingKm: 9 }),
    ]);
    expect(row).toMatchObject({
      C: '佐藤様',
      D: '09:00',
      E: '10:00',
      AI: '5.5',
      L: '鈴木様',
      H: '20',
      AG: '7.25',
      U: '田中様',
      // 0分/0kmは未入力ではなく0として入る
      Q: '0',
      AH: '0',
      AJ: '9',
      X: 'チームmtg',
      Y: '10:00',
      Z: '10:30',
      AA: '',
    });
  });

  it('出勤・退勤距離は、それを持つ予定から取る(先頭・末尾がオンライン予定でもよい)', () => {
    const row = buildRowDataFromAppointments([
      visit('オンライン相談', '09:00', '09:45'),
      visit('佐藤様', '10:00', '11:00', { attendanceKm: 3, leavingKm: 3 }),
      visit('オンライン相談', '12:00', '12:45'),
    ]);
    expect(row.AI).toBe('3');
    expect(row.AJ).toBe('3');
  });

  it('予定が無い日はカレンダー由来の列がすべて空になる', () => {
    const row = buildRowDataFromAppointments([]);
    expect(Object.values(row).every((v) => v === '')).toBe(true);
    expect(row).not.toHaveProperty('AO');
  });
});

describe('timeRangesOverlap', () => {
  it('端点が接するだけなら重ならない。時刻が読めなければ重ならない扱い', () => {
    expect(timeRangesOverlap('10:00', '11:00', '10:30', '12:00')).toBe(true);
    expect(timeRangesOverlap('10:00', '11:00', '11:00', '12:00')).toBe(false);
    expect(timeRangesOverlap('10:00', '', '10:30', '12:00')).toBe(false);
  });
});

describe('buildCalendarSyncPlan', () => {
  it('カレンダーにある枠は上書きし、値の変わった列だけを changes に出す', () => {
    const incoming = buildRowDataFromAppointments([visit('佐藤様', '10:00', '12:00', { attendanceKm: 4 })]);
    const plan = buildCalendarSyncPlan({ C: '佐藤様', D: '10:00', E: '11:30', AO: 'メモ' }, incoming);
    expect(plan.changes.map((c) => [c.column, c.oldValue, c.newValue])).toEqual([
      ['E', '11:30', '12:00'],
      ['AI', '', '4'],
    ]);
    expect(plan.valuesToApply).toEqual({ C: '佐藤様', D: '10:00', E: '12:00', AI: '4', AJ: '' });
    // 備考などカレンダーに無い列は触らない
    expect(plan.valuesToApply).not.toHaveProperty('AO');
  });

  it('手入力だけの枠は、カレンダーの予定と時間が重ならなければ残す', () => {
    const incoming = buildRowDataFromAppointments([visit('佐藤様', '10:00', '11:00')]);
    const plan = buildCalendarSyncPlan(
      { C: '佐藤様', D: '10:00', E: '11:00', X: '電話対応', Y: '15:00', Z: '16:00' },
      incoming,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.valuesToApply).not.toHaveProperty('X');
  });

  it('手入力だけの枠がカレンダー由来の枠と重なるなら、表現し直されたとみなしてクリアする', () => {
    // 出勤簿では#2に入っていた訪問が、カレンダー側では#1になった
    const incoming = buildRowDataFromAppointments([visit('鈴木様', '13:00', '14:00')]);
    const plan = buildCalendarSyncPlan({ L: '鈴木様', M: '13:00', N: '14:00', H: '15', AG: '3' }, incoming);
    expect(plan.valuesToApply).toMatchObject({
      C: '鈴木様',
      D: '13:00',
      E: '14:00',
      L: '',
      M: '',
      N: '',
      H: '',
      AG: '',
    });
  });

  it('退勤距離は訪問が2件以下の日でも、最後に埋まっている訪問の枠と一緒に反映する', () => {
    const incoming = buildRowDataFromAppointments([
      visit('佐藤様', '10:00', '11:00'),
      visit('鈴木様', '12:00', '13:00', { moveMin: 10, moveKm: 2, leavingKm: 6 }),
    ]);
    const plan = buildCalendarSyncPlan({}, incoming);
    expect(plan.valuesToApply.AJ).toBe('6');
    expect(plan.changes.some((c) => c.column === 'AJ' && c.newValue === '6')).toBe(true);
  });

  it('同じカレンダー内容で2回目に計画すると changes は空(冪等)', () => {
    const incoming = buildRowDataFromAppointments([visit('佐藤様', '10:00', '11:00', { leavingKm: 2 })]);
    const first = buildCalendarSyncPlan({}, incoming);
    const second = buildCalendarSyncPlan({ ...first.valuesToApply }, incoming);
    expect(first.changes.length).toBeGreaterThan(0);
    expect(second.changes).toEqual([]);
  });
});
