import { describe, expect, it } from 'vitest';
import {
  addDaysTo,
  autoEndTime,
  buildReceiptTimestamp,
  formatDateHeading,
  formatDateShort,
  formatDateTimeSummary,
  isNextDateDisabled,
  parseClock,
  shiftReportDate,
  toLocalDateString,
} from './dateTime';

describe('autoEndTime(GAS版 autoSetEndTime)', () => {
  it('始めた時間の2時間後(分はそのまま)', () => {
    expect(autoEndTime({ hour: '09', minute: '30' })).toEqual({ hour: '11', minute: '30' });
  });
  it('24時を越えたら0時に戻す', () => {
    expect(autoEndTime({ hour: '23', minute: '15' })).toEqual({ hour: '01', minute: '15' });
    expect(autoEndTime({ hour: '22', minute: '00' })).toEqual({ hour: '00', minute: '00' });
  });
  it('時が数字でなければ変えない', () => {
    expect(autoEndTime({ hour: '', minute: '00' })).toBeNull();
  });
});

describe('日付の表示', () => {
  it('日付送りの真ん中は半角かっこ、1行表示は全角かっこ', () => {
    expect(formatDateHeading('2026-09-25')).toBe('2026年9月25日(金)');
    expect(formatDateShort('2026-09-03')).toBe('9月3日（木）');
  });
  it('端末の暦日を YYYY-MM-DD にする', () => {
    expect(toLocalDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('月・年をまたいで日付を動かせる', () => {
    expect(addDaysTo('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysTo('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('formatDateTimeSummary(GAS版 updateDateTimeSummary_)', () => {
  const base = {
    date: '2026-09-03',
    start: { hour: '10', minute: '00' },
    end: { hour: '12', minute: '00' },
    occurrenceTime: '',
  };
  it('日報は「9月3日（木）10:00〜12:00」', () => {
    expect(formatDateTimeSummary({ ...base, mode: 'daily', occurrenceTime: '10:05' })).toBe(
      '9月3日（木）10:00〜12:00',
    );
  });
  it('事故は「起きた日時」の値を使って「… に起きた」', () => {
    expect(formatDateTimeSummary({ ...base, mode: 'accident', occurrenceTime: ' 10:05 ' })).toBe(
      '9月3日（木）10:05 に起きた',
    );
  });
  it('事故で起きた日時が空なら日付だけ(始めた時間を起きた時間と言い切らない)', () => {
    expect(formatDateTimeSummary({ ...base, mode: 'accident' })).toBe('9月3日（木）');
  });
  it('起きた日時に日付が入っていれば日付を重ねない', () => {
    expect(formatDateTimeSummary({ ...base, mode: 'accident', occurrenceTime: '2026年9月16日 10:00' })).toBe(
      '2026年9月16日 10:00 に起きた',
    );
    expect(formatDateTimeSummary({ ...base, mode: 'accident', occurrenceTime: '2026/09/16 10:00' })).toBe(
      '2026/09/16 10:00 に起きた',
    );
  });
});

describe('shiftReportDate(GAS版 changeDate: 今日より先には進めない)', () => {
  it('前の日へはいつでも動かせる', () => {
    expect(shiftReportDate('2026-09-25', -1, '2026-09-25')).toBe('2026-09-24');
  });
  it('今日から次の日へは動かせない', () => {
    expect(shiftReportDate('2026-09-25', 1, '2026-09-25')).toBeNull();
    expect(isNextDateDisabled('2026-09-25', '2026-09-25')).toBe(true);
  });
  it('昨日から今日へは動かせる', () => {
    expect(shiftReportDate('2026-09-24', 1, '2026-09-25')).toBe('2026-09-25');
    expect(isNextDateDisabled('2026-09-24', '2026-09-25')).toBe(false);
  });
});

describe('buildReceiptTimestamp(GAS版: 日報の日付 + 始めた時間、秒は00)', () => {
  it('yyyy/MM/dd HH:mm:ss', () => {
    expect(buildReceiptTimestamp('2026-09-03', { hour: '09', minute: '30' })).toBe('2026/09/03 09:30:00');
  });
  it('時刻が無ければ 00:00', () => {
    expect(buildReceiptTimestamp('2026-09-03', {})).toBe('2026/09/03 00:00:00');
  });
});

describe('parseClock', () => {
  it('HH:mm を分ける。空の部分は undefined', () => {
    expect(parseClock('09:30')).toEqual({ hour: '09', minute: '30' });
    expect(parseClock(':30')).toEqual({ hour: undefined, minute: '30' });
    expect(parseClock(undefined)).toEqual({});
  });
});
