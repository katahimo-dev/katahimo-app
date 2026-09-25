import { describe, expect, it } from 'vitest';
import { parseEventTitle } from './eventTitle';

describe('parseEventTitle', () => {
  it.each([
    ['[予約確定]山田 花子', 'confirmed', '山田 花子'],
    ['[新規] 体験訪問 佐々木様', 'newCustomer', '体験訪問 佐々木様'],
    ['[イベント]全体研修', 'specialEvent', '全体研修'],
    ['[事務]請求書作成', 'officeWork', '請求書作成'],
    ['歯医者', null, '歯医者'],
    ['', null, ''],
  ])('%s → %s / %s', (title, tag, name) => {
    expect(parseEventTitle(title)).toEqual({ tag, name });
  });

  it('複数のタグがあれば 予約確定 > 新規 > イベント > 事務 の順で1つに決まり、名前からは全タグが消える', () => {
    expect(parseEventTitle('[事務][イベント]月次ミーティング')).toEqual({
      tag: 'specialEvent',
      name: '月次ミーティング',
    });
    expect(parseEventTitle('[新規][予約確定]山田 花子')).toEqual({ tag: 'confirmed', name: '山田 花子' });
  });

  it('同じタグが2回あれば1回目だけを取り除く(GAS版 String.replace と同じ)', () => {
    expect(parseEventTitle('[事務]資料[事務]整理')).toEqual({ tag: 'officeWork', name: '資料[事務]整理' });
  });

  it('全角の括弧はタグとして扱わない', () => {
    expect(parseEventTitle('［事務］請求書')).toEqual({ tag: null, name: '［事務］請求書' });
  });
});
