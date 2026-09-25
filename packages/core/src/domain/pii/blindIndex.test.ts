import { describe, expect, it } from 'vitest';
import { computeBlindIndex } from './blindIndex';

describe('computeBlindIndex', () => {
  const key = Buffer.from('test-key-not-for-production-use-01', 'utf8');

  it('同じ入力・同じ鍵なら常に同じ値になる(等値検索に使うため決定的である必要がある)', () => {
    expect(computeBlindIndex('佐藤', key)).toBe(computeBlindIndex('佐藤', key));
  });

  it('鍵が違えば同じ入力でも別の値になる(テナントごとに鍵を分ければ、ある鍵の漏洩が他テナントの一致関係を漏らさない)', () => {
    const otherKey = Buffer.from('a-different-key-for-testing-only-02', 'utf8');
    expect(computeBlindIndex('佐藤', key)).not.toBe(computeBlindIndex('佐藤', otherKey));
  });

  it('入力が違えば別の値になる', () => {
    expect(computeBlindIndex('佐藤', key)).not.toBe(computeBlindIndex('鈴木', key));
  });
});
