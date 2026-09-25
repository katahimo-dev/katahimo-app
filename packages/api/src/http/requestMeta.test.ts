import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIpFromForwardedFor, clientIpMiddleware, requestMeta } from './requestMeta';

describe('X-Forwarded-For からの送信元IPの判定', () => {
  it('右から信頼する段数番目を使い、利用者が付けた左側の値は使わない', () => {
    // 利用者が "1.1.1.1" を偽装して送り、Google Front End が実際の接続元 203.0.113.5 を末尾に付けた
    expect(clientIpFromForwardedFor('1.1.1.1, 203.0.113.5', 1)).toBe('203.0.113.5');
    // 外部ロードバランサ(末尾にLBのIP)を前に置いた構成
    expect(clientIpFromForwardedFor('1.1.1.1, 203.0.113.5, 34.1.2.3', 2)).toBe('203.0.113.5');
  });

  it('0段・ヘッダー無し・段数不足は null(接続元のアドレスを使う)', () => {
    expect(clientIpFromForwardedFor('203.0.113.5', 0)).toBeNull();
    expect(clientIpFromForwardedFor(undefined, 1)).toBeNull();
    expect(clientIpFromForwardedFor('203.0.113.5', 2)).toBeNull();
  });

  it('ミドルウェアが判定した値を requestMeta が使う', async () => {
    const app = new Hono();
    app.use('*', clientIpMiddleware(1));
    app.get('/', (c) => c.json(requestMeta(c)));
    const res = await app.request('/', {
      headers: { 'x-forwarded-for': 'spoofed, 198.51.100.20', 'user-agent': 'test-agent' },
    });
    expect(await res.json()).toEqual({ ip: '198.51.100.20', userAgent: 'test-agent' });
  });
});
