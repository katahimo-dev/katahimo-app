import { describe, expect, it } from 'vitest';
import { extractCityFromAddress } from './extractCityFromAddress';

describe('extractCityFromAddress', () => {
  it('都道府県が無い住所からも「市+区」を抽出する', () => {
    expect(extractCityFromAddress('仙台市泉区x-x-x')).toBe('仙台市泉区');
  });

  it('都道府県付きの住所は都道府県を除いて「区」だけを抽出する(政令指定都市でない場合)', () => {
    expect(extractCityFromAddress('東京都渋谷区代々木1-1-1')).toBe('渋谷区');
  });

  it('政令指定都市の住所は「市+区」を抽出する', () => {
    expect(extractCityFromAddress('北海道札幌市中央区北1条西2丁目')).toBe('札幌市中央区');
    expect(extractCityFromAddress('大阪府大阪市北区梅田1-1-1')).toBe('大阪市北区');
  });

  it('区が無い市区町村は市/町/村単位にフォールバックする', () => {
    expect(extractCityFromAddress('千葉県浦安市舞浜1-1')).toBe('浦安市');
    expect(extractCityFromAddress('群馬県甘楽郡下仁田町本宿1')).toBe('甘楽郡下仁田町');
  });

  it('抽出できない/空の住所は空文字を返す', () => {
    expect(extractCityFromAddress('')).toBe('');
    expect(extractCityFromAddress('1-1-1')).toBe('');
    expect(extractCityFromAddress('東京都')).toBe('');
  });
});
