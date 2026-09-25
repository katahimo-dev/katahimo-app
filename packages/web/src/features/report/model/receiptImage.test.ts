import { describe, expect, it } from 'vitest';
import { computeResizedSize, fromDatetimeLocal, nowDatetimeLocal, toDatetimeLocal } from './receiptImage';

describe('computeResizedSize(GAS版 resizeAndAddImage: 長い辺を1200pxまで)', () => {
  it('横長は幅で縮める', () => {
    expect(computeResizedSize(4000, 3000)).toEqual({ width: 1200, height: 900 });
  });
  it('縦長は高さで縮める', () => {
    expect(computeResizedSize(3000, 4000)).toEqual({ width: 900, height: 1200 });
  });
  it('正方形は高さで判定する', () => {
    expect(computeResizedSize(2400, 2400)).toEqual({ width: 1200, height: 1200 });
  });
  it('1200px以下はそのまま', () => {
    expect(computeResizedSize(300, 600)).toEqual({ width: 300, height: 600 });
    expect(computeResizedSize(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
  it('割り切れないときは小数のまま(canvas に入れると切り捨て)', () => {
    const { width, height } = computeResizedSize(1000, 3000);
    expect(height).toBe(1200);
    expect(width).toBeCloseTo(400);
    expect(computeResizedSize(1300, 1000).height).toBeCloseTo(923.0769, 3);
  });
});

describe('datetime-local との変換', () => {
  it('OCRの yyyy/MM/dd HH:mm → yyyy-MM-ddTHH:mm', () => {
    expect(toDatetimeLocal('2026/09/25 11:02')).toBe('2026-09-25T11:02');
    expect(toDatetimeLocal(' 2026/09/25 9:5 ')).toBe('2026-09-25T09:05');
    expect(toDatetimeLocal('2026/09/25')).toBe('2026-09-25T00:00');
  });
  it('読めない値は空文字', () => {
    expect(toDatetimeLocal('2026-09-25 11:02')).toBe('');
    expect(toDatetimeLocal('')).toBe('');
    expect(toDatetimeLocal(null)).toBe('');
  });
  it('yyyy-MM-ddTHH:mm → yyyy/MM/dd HH:mm', () => {
    expect(fromDatetimeLocal('2026-09-25T11:02')).toBe('2026/09/25 11:02');
    expect(fromDatetimeLocal('')).toBe('');
  });
  it('今の日時(分まで)', () => {
    expect(nowDatetimeLocal(new Date(2026, 8, 5, 7, 3, 59))).toBe('2026-09-05T07:03');
  });
});
