import { describe, expect, it } from 'vitest';
import { normalizeEmailForIndex } from './normalize';

describe('normalizeEmailForIndex', () => {
  it('大文字/小文字・前後空白を無視する', () => {
    expect(normalizeEmailForIndex('  Hanako.Sato@Example.com  ')).toBe('hanako.sato@example.com');
  });
});
