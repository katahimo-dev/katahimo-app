import { describe, expect, it } from 'vitest';
import { normalizeResetCodeInput } from './resetCode';

describe('normalizeResetCodeInput(再設定コードの欄)', () => {
  it('全角の数字は半角に、数字以外は除き、8桁で切る', () => {
    expect(normalizeResetCodeInput('１２３４５６７８')).toBe('12345678');
    expect(normalizeResetCodeInput('1234 5678')).toBe('12345678');
    expect(normalizeResetCodeInput('1234-5678-9')).toBe('12345678');
    expect(normalizeResetCodeInput('abc')).toBe('');
  });
});
