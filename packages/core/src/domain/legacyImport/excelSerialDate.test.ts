import { describe, expect, it } from 'vitest';
import { excelSerialDateToIso } from './excelSerialDate';

describe('excelSerialDateToIso', () => {
  it('シリアル日時をISO8601に変換する(実際のRESERVA CSVサンプル値で検証)', () => {
    expect(excelSerialDateToIso('45882.55')).toBe('2025-08-13T13:12:00.000Z');
    expect(excelSerialDateToIso('45945.99583')).toBe('2025-10-15T23:53:59.712Z');
  });

  it('数値でも文字列でも同じ結果になる', () => {
    expect(excelSerialDateToIso(45882.55)).toBe(excelSerialDateToIso('45882.55'));
  });

  it('数値として解釈できない場合はnullを返す', () => {
    expect(excelSerialDateToIso('')).toBeNull();
    expect(excelSerialDateToIso('not-a-number')).toBeNull();
  });
});
