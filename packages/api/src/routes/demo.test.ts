import { describe, expect, it } from 'vitest';
import { demoConfigOf } from './demo';

describe('demoConfigOf', () => {
  it('デモ専用環境でも認証情報を未ログインの応答へ含めない', () => {
    expect(
      demoConfigOf({
        slug: 'public-demo',
        publicLogin: true,
        dataRetentionDays: 30,
        logRetentionMonths: 12,
      }),
    ).toMatchObject({
      enabled: true,
      tenantSlug: 'public-demo',
      publicLogin: true,
      accounts: [],
      password: null,
    });
  });
});
