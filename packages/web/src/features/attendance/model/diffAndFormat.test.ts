import { describe, expect, it } from 'vitest';
import { buildDiffRows, diffCountText, sameAsCalendarMessage } from './diff';
import { formatKmJa, formatMinutesJa, formatYen } from './format';
import { savedMessage } from './saveMessage';

describe('カレンダーと違うところ', () => {
  it('空の値は（空欄）にする', () => {
    expect(
      buildDiffRows([
        { column: 'E', label: '#1終業時刻', oldValue: '11:30', newValue: '11:45' },
        { column: 'X', label: '作業１', oldValue: '', newValue: '' },
      ]),
    ).toEqual([
      { key: 'E-0', label: '#1終業時刻', oldText: '11:30', newText: '11:45' },
      { key: 'X-1', label: '作業１', oldText: '（空欄）', newText: '（空欄）' },
    ]);
  });
  it('件数の文言', () => {
    expect(diffCountText(4, 2)).toBe('カレンダーの予定 4件 / 直すところ 2件');
    expect(sameAsCalendarMessage(3)).toBe('出勤簿はカレンダーと同じです（予定 3件）');
    expect(sameAsCalendarMessage(undefined)).toBe('出勤簿はカレンダーと同じです');
  });
});

describe('数字の見せ方', () => {
  it('分', () => {
    expect(formatMinutesJa(0)).toBe('0分');
    expect(formatMinutesJa(45)).toBe('45分');
    expect(formatMinutesJa(60)).toBe('1時間');
    expect(formatMinutesJa(450)).toBe('7時間30分');
    expect(formatMinutesJa('')).toBe('—');
    expect(formatMinutesJa(-1)).toBe('—');
  });
  it('km・円', () => {
    expect(formatKmJa(42.699999)).toBe('42.7km');
    expect(formatKmJa('x')).toBe('—');
    expect(formatYen(6360)).toBe('6,360円');
  });
  it('保存のお知らせはサーバーの文言、無ければ変わった数で', () => {
    expect(savedMessage({ message: '変更はありませんでした。', changedCount: 0 })).toBe(
      '変更はありませんでした。',
    );
    expect(savedMessage({ message: '', changedCount: 2 })).toBe('保存しました');
    expect(savedMessage({ message: '', changedCount: 0 })).toBe('変更はありませんでした');
  });
});
