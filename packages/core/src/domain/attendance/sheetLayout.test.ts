import { describe, expect, it } from 'vitest';
import { isDomainError } from '../errors';
import { type AttendanceSheetDay, diffAttendanceSheets, emptySheetDay } from './entities';
import { applyRowEdit, canonicalizeRowData, compactRowData, projectDay } from './sheetLayout';

let counter = 0;
const newId = () => `id-${++counter}`;
const edit = (
  sheet: AttendanceSheetDay,
  patch: Record<string, string>,
  source: 'user' | 'calendar_sync' = 'user',
) => applyRowEdit(sheet, patch, { source, newId });

describe('出勤簿の行 ↔ 実体(projectDay / applyRowEdit)', () => {
  it('送られた列のうち値が変わった列だけを変え、手で変えた列を強調表示の列として返す', () => {
    const first = edit(emptySheetDay('day'), { C: '佐藤様', D: '10:00' });
    expect(first.changes.map((c) => c.column)).toEqual(['C', 'D']);
    const second = edit(first.next, { C: '佐藤様', D: '10:30', E: '12:00', AO: '雨' });
    expect(second.changes).toEqual([
      { column: 'D', label: '#1始業時刻', oldValue: '10:00', newValue: '10:30' },
      { column: 'E', label: '#1終業時刻', oldValue: '', newValue: '12:00' },
      { column: 'AO', label: '備考', oldValue: '', newValue: '雨' },
    ]);
    const projection = projectDay(second.next);
    expect(compactRowData(projection.rowData)).toEqual({ C: '佐藤様', D: '10:30', E: '12:00', AO: '雨' });
    expect(projection.changedFields).toEqual(['C', 'D', 'E', 'AO']);
    expect(second.next.visits).toEqual([
      expect.objectContaining({ seq: 1, label: '佐藤様', start: 630, end: 720, source: 'manual' }),
    ]);
  });

  it('送られていない列は変えず、全ての列が空になった実体は消す', () => {
    const { next } = edit(emptySheetDay('day'), { C: '佐藤様', D: '10:00', E: '11:00', X: '事務', AN: '1' });
    const cleared = edit(next, { C: '', D: '', E: '' });
    expect(cleared.next.visits).toEqual([]);
    expect(compactRowData(projectDay(cleared.next).rowData)).toEqual({ X: '事務', AN: '1' });
  });

  it('カレンダー反映は強調表示の列を増やさず、予定の時刻を planned にも入れる', () => {
    const { next } = edit(
      emptySheetDay('day'),
      { L: '田中様', M: '13:00', N: '14:00', H: '20', AG: '6' },
      'calendar_sync',
    );
    const projection = projectDay(next);
    expect(projection.changedFields).toEqual([]);
    expect(projection.rowData.AG).toBe('6.00');
    expect(next.visits[0]).toMatchObject({
      seq: 2,
      plannedStart: 780,
      plannedEnd: 840,
      source: 'google_calendar',
    });
    expect(next.legs).toEqual([
      expect.objectContaining({ kind: 'between', seq: 1, plannedMinutes: 20, distanceKm: 6 }),
    ]);
  });

  it('日付をまたぐ訪問は終了を翌日として持ち、出勤簿には 24 時間表記で出す', () => {
    const { next } = edit(emptySheetDay('day'), { C: '夜間', D: '22:00', E: '01:00' });
    expect(next.visits[0]).toMatchObject({ start: 1320, end: 1500 });
    expect(projectDay(next).rowData.E).toBe('01:00');
  });

  it('形式の違う値・選択肢に無い天候・重なる訪問は validation_failed', () => {
    const errorOf = (patch: Record<string, string>) => {
      try {
        edit(emptySheetDay('day'), patch);
      } catch (e) {
        return isDomainError(e) ? [e.code, Object.keys(e.fields ?? {})] : e;
      }
      return null;
    };
    expect(errorOf({ D: '10時' })).toEqual(['validation_failed', ['rowData.D']]);
    expect(errorOf({ I: '台風' })).toEqual(['validation_failed', ['rowData.I']]);
    expect(errorOf({ AG: 'abc', AN: '1.5' })).toEqual(['validation_failed', ['rowData.AG', 'rowData.AN']]);
    expect(errorOf({ D: '10:00', E: '12:00', M: '11:00', N: '13:00' })).toEqual([
      'validation_failed',
      ['rowData'],
    ]);
  });

  it('表記の揺れ(9:00・6)は正規の表記で比べ、同じ値なら変更なし', () => {
    const { next } = edit(emptySheetDay('day'), { D: '09:00', AG: '6.00' });
    expect(edit(next, { D: '9:00', AG: '6' }).changes).toEqual([]);
    expect(canonicalizeRowData({ D: '9:00', AG: '5.2', H: '20', C: ' 佐藤様' })).toEqual({
      D: '09:00',
      AG: '5.20',
      H: '20',
      C: ' 佐藤様',
    });
  });

  it('差分は実体のIDで突き合わせ、変わった項目の名前を返す', () => {
    const { next: before } = edit(emptySheetDay('day'), { C: '佐藤様', D: '10:00' });
    const { next: after } = edit(before, { D: '10:30', X: '事務' });
    const diff = diffAttendanceSheets(before, after);
    expect(diff.visits.update).toEqual([expect.objectContaining({ changedFields: ['start'] })]);
    expect(diff.segments.insert).toHaveLength(1);
    expect(diff.day).toBeNull();
  });
});
