import { describe, expect, it } from 'vitest';
import { appointment, jst } from './__fixtures__/builders';
import { appointmentsForStaff } from './staffAppointments';

describe('appointmentsForStaff', () => {
  const visit = appointment({ name: '訪問', start: jst('2026-09-25 13:00'), assigneeNames: ['佐藤 美咲'] });
  const event = appointment({
    type: 'EVENT',
    name: '研修',
    start: jst('2026-09-25 09:00'),
    assigneeNames: ['高橋 由美', '佐藤　美咲'],
  });
  const other = appointment({ name: '他の人', assigneeNames: ['高橋 由美'] });
  const sameTimeOffice = appointment({
    type: 'OFFICE WORK',
    name: '事務',
    start: jst('2026-09-25 13:00'),
    assigneeNames: ['佐藤美咲'],
  });

  it('担当者名(空白差異は無視)が一致する予定だけを開始時刻順に返す。同時刻は元の順', () => {
    expect(
      appointmentsForStaff([visit, other, sameTimeOffice, event], '佐藤 美咲').map((a) => a.name),
    ).toEqual(['研修', '訪問', '事務']);
  });

  it('該当が無ければ空', () => {
    expect(appointmentsForStaff([visit], '鈴木 一郎')).toEqual([]);
  });
});
