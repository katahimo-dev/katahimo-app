import { describe, expect, it } from 'vitest';
import { appointment, jst } from './__fixtures__/builders';
import { mergeOverlappingOfficeWork } from './officeWork';
import type { Appointment } from './types';

function office(name: string, from: string, to: string, staff = '高橋 由美', address = ''): Appointment {
  return appointment({
    type: 'OFFICE WORK',
    name,
    customerId: '',
    place: { address, latLng: null },
    start: jst(`2026-09-25 ${from}`),
    end: jst(`2026-09-25 ${to}`),
    assigneeNames: [staff],
  });
}

const summary = (list: Appointment[]) =>
  list.map((a) => `${a.type === 'OFFICE WORK' ? '事務' : '訪問'}:${a.name}:${a.assigneeNames[0]}`);

describe('mergeOverlappingOfficeWork', () => {
  it('重なる事務作業は1件にまとめ、名前は「,」区切り、終了は最も遅い時刻、場所は最初の予定', () => {
    const merged = mergeOverlappingOfficeWork([
      office('請求書', '09:00', '10:00', '高橋 由美', '事務所'),
      office('電話対応', '09:30', '11:00', '高橋 由美', '自宅'),
      office('日報確認', '10:30', '10:45'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: '請求書,電話対応,日報確認',
      start: jst('2026-09-25 09:00'),
      end: jst('2026-09-25 11:00'),
      place: { address: '事務所' },
    });
  });

  it('ちょうど終了時刻に始まる予定はまとめない', () => {
    const merged = mergeOverlappingOfficeWork([office('A', '09:00', '10:00'), office('B', '10:00', '11:00')]);
    expect(merged.map((a) => a.name)).toEqual(['A', 'B']);
  });

  it('入力順に関係なく開始時刻順に判定する', () => {
    const merged = mergeOverlappingOfficeWork([
      office('後', '09:30', '10:30'),
      office('先', '09:00', '10:00'),
    ]);
    expect(merged.map((a) => a.name)).toEqual(['先,後']);
  });

  it('スタッフ名の空白差異は同じスタッフとして扱い、担当者名は最初に出てきた表記', () => {
    const merged = mergeOverlappingOfficeWork([
      office('A', '09:00', '10:00', '高橋　由美'),
      office('B', '09:30', '10:30', '高橋由美'),
    ]);
    expect(summary(merged)).toEqual(['事務:A,B:高橋　由美']);
  });

  it('別のスタッフの事務作業はまとめない', () => {
    const merged = mergeOverlappingOfficeWork([
      office('A', '09:00', '10:00', '高橋 由美'),
      office('B', '09:30', '10:30', '佐藤 美咲'),
    ]);
    expect(summary(merged)).toEqual(['事務:A:高橋 由美', '事務:B:佐藤 美咲']);
  });

  it('事務以外は元の順のまま先頭に、まとめた事務はスタッフの初出順に後ろへ並ぶ', () => {
    const visit = appointment({ name: '山田 花子' });
    const merged = mergeOverlappingOfficeWork([
      office('A', '13:00', '14:00', '佐藤 美咲'),
      visit,
      office('B', '09:00', '10:00', '高橋 由美'),
      office('C', '08:00', '09:00', '佐藤 美咲'),
    ]);
    expect(summary(merged)).toEqual([
      '訪問:山田 花子:佐藤 美咲',
      '事務:C:佐藤 美咲',
      '事務:A:佐藤 美咲',
      '事務:B:高橋 由美',
    ]);
  });

  it('事務作業が無ければそのまま返す', () => {
    const list = [appointment()];
    expect(mergeOverlappingOfficeWork(list)).toBe(list);
  });
});
