import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './memoryStorage.test-helper';
import { applyTextSizeToDocument, nextTextSize, normalizeTextSize, readStoredTextSize } from './textSize';

describe('normalizeTextSize(GAS版 normalizeTextSize_)', () => {
  it('3段階の値はそのまま', () => {
    expect(normalizeTextSize('normal')).toBe('normal');
    expect(normalizeTextSize('large')).toBe('large');
    expect(normalizeTextSize('xlarge')).toBe('xlarge');
  });

  it('以前の small / medium や未保存・不明な値は normal', () => {
    expect(normalizeTextSize('small')).toBe('normal');
    expect(normalizeTextSize('medium')).toBe('normal');
    expect(normalizeTextSize(null)).toBe('normal');
    expect(normalizeTextSize(undefined)).toBe('normal');
    expect(normalizeTextSize('')).toBe('normal');
    expect(normalizeTextSize('LARGE')).toBe('normal');
  });
});

describe('nextTextSize(GAS版 cycleTextSize)', () => {
  it('ふつう→大きい→とても大きい→ふつう と回る', () => {
    expect(nextTextSize('normal')).toBe('large');
    expect(nextTextSize('large')).toBe('xlarge');
    expect(nextTextSize('xlarge')).toBe('normal');
  });
});

describe('applyTextSizeToDocument(GAS版 applyTextSize)', () => {
  it('data-text-size を設定し、正規化した値を app_text_size に保存する', () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (k: string, v: string) => (attrs[k] = v) } as unknown as HTMLElement;
    const storage = createMemoryStorage({ app_text_size: 'medium' });

    // 起動時: 古い値 medium は normal に置きかわって保存し直される
    expect(applyTextSizeToDocument(readStoredTextSize(storage), root, storage)).toBe('normal');
    expect(attrs['data-text-size']).toBe('normal');
    expect(storage.snapshot()).toEqual({ app_text_size: 'normal' });

    expect(applyTextSizeToDocument('xlarge', root, storage)).toBe('xlarge');
    expect(attrs['data-text-size']).toBe('xlarge');
    expect(readStoredTextSize(storage)).toBe('xlarge');
  });
});
