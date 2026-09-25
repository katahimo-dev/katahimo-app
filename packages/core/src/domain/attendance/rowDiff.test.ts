import { describe, expect, it } from 'vitest';
import { applyRowPatch, mergeChangedFields } from './rowDiff';

describe('applyRowPatch', () => {
  it('送られた列のうち値が変わった列だけを変更として扱う(未入力は空文字と同じ)', () => {
    const { next, changes } = applyRowPatch(
      { C: '佐藤様', D: '10:00' },
      { C: '佐藤様', D: '10:30', E: '', AO: '雨' },
    );
    expect(changes).toEqual([
      { column: 'D', label: '#1始業時刻', oldValue: '10:00', newValue: '10:30' },
      { column: 'AO', label: '備考', oldValue: '', newValue: '雨' },
    ]);
    expect(next).toEqual({ C: '佐藤様', D: '10:30', AO: '雨' });
  });

  it('送られていない列は変更しない', () => {
    const { next, changes } = applyRowPatch({ C: '佐藤様', D: '10:00' }, { AO: 'メモ' });
    expect(changes.map((c) => c.column)).toEqual(['AO']);
    expect(next).toEqual({ C: '佐藤様', D: '10:00', AO: 'メモ' });
  });

  it('空文字で送れば値を消せる', () => {
    const { next, changes } = applyRowPatch({ C: '佐藤様' }, { C: '' });
    expect(changes).toEqual([{ column: 'C', label: '#1訪問先等', oldValue: '佐藤様', newValue: '' }]);
    expect(next.C).toBe('');
  });
});

describe('mergeChangedFields', () => {
  it('既存の変更列と今回の変更列を重複なく列の定義順でまとめる', () => {
    expect(mergeChangedFields(['AO', 'D'], ['C', 'D'])).toEqual(['C', 'D', 'AO']);
  });
});
