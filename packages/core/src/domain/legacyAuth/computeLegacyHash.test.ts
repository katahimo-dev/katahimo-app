import { describe, expect, it } from 'vitest';
import { computeLegacyHash } from './computeLegacyHash';

/**
 * 期待値は、GAS版 gas-childcare-visit-app/Auth.js の computeHash() をNode上でそのまま実行し
 * (crypto.createHash('sha256').update(password+salt).digest('hex') と同一であることを確認済み)
 * 得た値。
 */
describe('computeLegacyHash', () => {
  it('GAS版computeHashと同じ値を返す(実行結果で検証済み)', () => {
    expect(computeLegacyHash('mypassword123', 'test-salt-value')).toBe(
      'bcb42c133bf40a684228ebcc6466baa6938eb22da95b502d6a4078007a77e345',
    );
  });

  it('日本語パスワードでも一致する', () => {
    expect(computeLegacyHash('日本語パスワード', 'salt2')).toBe(
      '120426c1324a3bb1293777d763d4f18be5cadfe0746f0ef76ed853009c9e2e97',
    );
  });

  it('空文字のパスワードは空文字を返す(GAS版 if (!raw) return "" と同じ)', () => {
    expect(computeLegacyHash('', 'test-salt-value')).toBe('');
  });

  it('ソルトが空の場合は例外を投げる(既定値へフォールバックしない)', () => {
    expect(() => computeLegacyHash('password', '')).toThrow();
  });

  it('ソルトが違えば同じパスワードでも別の値になる', () => {
    expect(computeLegacyHash('password', 'salt-a')).not.toBe(computeLegacyHash('password', 'salt-b'));
  });
});
