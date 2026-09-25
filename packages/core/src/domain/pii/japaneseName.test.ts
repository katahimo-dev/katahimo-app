import { describe, expect, it } from 'vitest';
import { splitJapaneseFullName } from './japaneseName';

describe('splitJapaneseFullName', () => {
  it('半角スペース区切りを姓・名に分割する', () => {
    expect(splitJapaneseFullName('佐藤 花子')).toEqual({
      familyName: '佐藤',
      givenName: '花子',
      isAmbiguous: false,
    });
  });

  it('全角スペース区切りにも対応する', () => {
    expect(splitJapaneseFullName('佐藤　花子')).toEqual({
      familyName: '佐藤',
      givenName: '花子',
      isAmbiguous: false,
    });
  });

  it('前後の余分な空白は無視する', () => {
    expect(splitJapaneseFullName('  佐藤 花子  ')).toEqual({
      familyName: '佐藤',
      givenName: '花子',
      isAmbiguous: false,
    });
  });

  it('区切りが無い場合は分割不能とし、全体を姓側に入れてisAmbiguousをtrueにする', () => {
    expect(splitJapaneseFullName('佐藤花子')).toEqual({
      familyName: '佐藤花子',
      givenName: '',
      isAmbiguous: true,
    });
  });
});
