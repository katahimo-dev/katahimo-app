import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  type CalendarEvent,
  computeHourRange,
  eventBox,
  eventTitleForList,
  minutesToHhmm,
  summarizeDayEvents,
  timeToMinutes,
  updatedAtLabel,
  weekDates,
  weekRangeLabel,
  weekStartOf,
} from './week';

const ev = (
  start: string,
  end: string,
  title = 'A',
  eventType: CalendarEvent['eventType'] = 'CUSTOMER APPOINTMENT',
): CalendarEvent => ({
  date: '2026-09-25',
  slotKey: 'slot1',
  title,
  eventType,
  start,
  end,
});

describe('週の範囲・見出し', () => {
  it('その日を含む週の日曜日を返す(月・年をまたぐ場合も)', () => {
    expect(weekStartOf('2026-09-25')).toBe('2026-09-20');
    expect(weekStartOf('2026-09-20')).toBe('2026-09-20');
    expect(weekStartOf('2026-09-05')).toBe('2026-08-30');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-27');
  });
  it('7日分と「M月D日〜M月D日」', () => {
    expect(weekDates('2026-08-30')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
    expect(weekRangeLabel('2026-08-30')).toBe('8月30日〜9月5日');
    expect(addDaysYmd('2026-09-20', -21)).toBe('2026-08-30');
  });
  it('「HH:MM 時点」(時刻が無ければ空)', () => {
    expect(updatedAtLabel(Date.parse('2026-09-25T09:05:00+09:00'))).toBe('09:05 時点');
    expect(updatedAtLabel(null)).toBe('');
  });
});

describe('時刻', () => {
  it('HH:MM を分にする(形が違えば null)', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('0:00')).toBe(0);
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes('9時')).toBeNull();
  });
  it('分を HH:MM に戻す(24時間をこえたら余り)', () => {
    expect(minutesToHhmm(600)).toBe('10:00');
    expect(minutesToHhmm(25 * 60)).toBe('01:00');
  });
});

describe('表の時間の範囲(9〜20時が基本)', () => {
  it('予定が範囲内ならそのまま', () => {
    expect(computeHourRange([ev('09:30', '17:30')])).toEqual({ startHour: 9, endHour: 20 });
  });
  it('早い・遅い予定があれば広げる(終わりは切り上げ)', () => {
    expect(computeHourRange([ev('07:15', '08:00'), ev('20:10', '21:30')])).toEqual({
      startHour: 7,
      endHour: 22,
    });
  });
  it('予定が無ければ既定', () => {
    expect(computeHourRange([])).toEqual({ startHour: 9, endHour: 20 });
  });
  it('0時ちょうどの終わりを始めに潰さない・最小の高さ', () => {
    expect(eventBox(ev('09:00', '10:30'), 9, 40, 15)).toEqual({ top: 0, height: 60 });
    expect(eventBox(ev('10:00', '10:05'), 9, 40, 15)).toEqual({ top: 40, height: 15 });
  });
});

describe('一覧の1行(calSummarizeDayEvents_)', () => {
  it('時間順に件名を → でつなぎ、範囲と合計を出す', () => {
    const s = summarizeDayEvents([
      ev('12:30', '14:30', '佐々木 あおい'),
      ev('15:00', '15:30', '事務作業', 'OFFICE WORK'),
      ev('09:30', '11:30', '田中 さくら'),
    ]);
    expect(s.titles).toBe('田中 さくら → 佐々木 あおい → 事務作業');
    expect(s.timeRange).toBe('09:30〜15:30');
    expect(s.totalMinutes).toBe(270);
  });
  it('日をまたぐ予定は翌日分として数える', () => {
    const s = summarizeDayEvents([ev('22:00', '01:00')]);
    expect(s.timeRange).toBe('22:00〜01:00');
    expect(s.totalMinutes).toBe(180);
  });
  it('時刻が読めなければ範囲は空', () => {
    expect(summarizeDayEvents([ev('', '')]).timeRange).toBe('');
  });
  it('件名: 訪問はお客様名、事務作業は種類(件名が違えば括弧で添える)', () => {
    expect(eventTitleForList({ title: '', eventType: 'CUSTOMER APPOINTMENT' })).toBe('（名前なし）');
    expect(eventTitleForList({ title: '事務作業', eventType: 'OFFICE WORK' })).toBe('事務作業');
    expect(eventTitleForList({ title: 'mtg', eventType: 'OFFICE WORK' })).toBe('事務作業（mtg）');
    expect(eventTitleForList({ title: '', eventType: 'EVENT' })).toBe('イベント');
  });
});
