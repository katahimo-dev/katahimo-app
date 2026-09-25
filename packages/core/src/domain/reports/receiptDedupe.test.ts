import { describe, expect, it } from 'vitest';
import {
  buildReceiptDedupeKey,
  canCheckReceiptDuplicate,
  normalizeAmount,
  normalizeText,
} from './receiptDedupe';

describe('normalizeAmount', () => {
  it('カンマ区切りの金額を数値の文字列表現に正規化する', () => {
    expect(normalizeAmount('1,000')).toBe('1000');
  });
  it('数値に変換できない値はtrimして返す(GAS版と同じフォールバック)', () => {
    expect(normalizeAmount('abc')).toBe('abc');
  });
  it('空文字・null・undefinedは空文字を返す', () => {
    expect(normalizeAmount('')).toBe('');
    expect(normalizeAmount(null)).toBe('');
    expect(normalizeAmount(undefined)).toBe('');
  });
});

describe('normalizeText', () => {
  it('前後の空白をtrimする', () => {
    expect(normalizeText('  コンビニ  ')).toBe('コンビニ');
  });
  it('null・undefinedは空文字を返す', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('canCheckReceiptDuplicate', () => {
  it('金額・店舗名の両方があるときだけtrue', () => {
    expect(canCheckReceiptDuplicate({ amount: '1000', storeName: 'コンビニ' })).toBe(true);
    expect(canCheckReceiptDuplicate({ amount: '', storeName: 'コンビニ' })).toBe(false);
    expect(canCheckReceiptDuplicate({ amount: '1000', storeName: '' })).toBe(false);
  });
});

describe('buildReceiptDedupeKey', () => {
  it('GAS版processReceiptImagesのbuildKeyと同じ組み立て(||区切り)', () => {
    expect(
      buildReceiptDedupeKey({
        timestamp: '2026/08/28 12:00:00',
        staffId: 's1',
        customerId: 'c1',
        amount: '1,000',
        storeName: ' コンビニ ',
      }),
    ).toBe('2026/08/28 12:00:00||s1||c1||1000||コンビニ');
  });
});
