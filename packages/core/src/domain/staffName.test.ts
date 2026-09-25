import { describe, expect, it } from 'vitest';
import { isSameStaffName, normalizeStaffName } from './staffName';

describe('normalizeStaffName', () => {
  it('半角・全角スペース・タブ・改行をすべて除去する', () => {
    expect(normalizeStaffName('佐藤 花子')).toBe('佐藤花子');
    expect(normalizeStaffName('佐藤　花子')).toBe('佐藤花子');
    expect(normalizeStaffName('佐藤\t花子')).toBe('佐藤花子');
    expect(normalizeStaffName(' 佐藤 花子 ')).toBe('佐藤花子');
  });

  it('null/undefined/数値でも例外を投げない(GAS版 String(str || "") と同じ挙動)', () => {
    expect(normalizeStaffName(null)).toBe('');
    expect(normalizeStaffName(undefined)).toBe('');
    expect(normalizeStaffName(0)).toBe('0');
  });
});

describe('isSameStaffName', () => {
  it('表記ゆれを無視して一致判定する', () => {
    expect(isSameStaffName('佐藤 花子', '佐藤　花子')).toBe(true);
    expect(isSameStaffName('佐藤花子', '鈴木次郎')).toBe(false);
  });

  it('空文字同士は一致とみなさない(未入力セル同士が誤って結び付くのを防ぐ)', () => {
    expect(isSameStaffName('', '')).toBe(false);
    expect(isSameStaffName('   ', null)).toBe(false);
  });
});
