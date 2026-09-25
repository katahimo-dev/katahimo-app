import { describe, expect, it } from 'vitest';
import { extractAllergy } from './extractAllergy';

describe('extractAllergy', () => {
  it.each([
    ['保育園 アレルギーなし', 'なし'],
    ['アレルギー:無し', 'なし'],
    ['アレルギー：卵', '卵'],
    ['幼稚園 卵アレルギー 年中クラス', '卵アレルギー'],
    ['アレルギー:乳・小麦 母乳', '乳・小麦'],
  ])('%s → %s', (info, expected) => {
    expect(extractAllergy(info)).toBe(expected);
  });

  it('アレルギーの記述が無ければnull', () => {
    expect(extractAllergy('会社員 保育園')).toBeNull();
    expect(extractAllergy('')).toBeNull();
  });

  it('「なし」と具体的な記述が混在する場合は具体的な記述を優先する', () => {
    expect(extractAllergy('アレルギーなし 卵アレルギー')).toBe('卵アレルギー');
  });
});
