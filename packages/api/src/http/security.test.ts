import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@katahimo/db';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { noStoreApiResponses } from './security';

/** DBに触らないエンドポイントだけを叩くため、DBは使われたら分かる偽物にする。 */
const noDb = new Proxy({} as Database, {
  get() {
    throw new Error('このテストではDBを使わない');
  },
});

let distDir: string;
beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'katahimo-sec-dist-'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
});
afterAll(() => rmSync(distDir, { recursive: true, force: true }));

function appFor(overrides: Record<string, string> = {}) {
  const env = loadEnv({
    DATABASE_URL: 'postgres://katahimo_app:x@localhost:5432/katahimo_dev',
    SESSION_SECRET: 'test-session-secret-0123456789',
    SECRET_BOX_LOCAL_KEY: 'a'.repeat(64),
    SCHEDULE_PROVIDER: 'noop',
    WEB_DIST_DIR: distDir,
    ...overrides,
  });
  return createApp({ env, container: createContainer(env, noDb) });
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('セキュリティヘッダー', () => {
  it('APIの応答にCSP・nosniff・Referrer-Policy・no-store を付ける(開発はHSTSなし)', async () => {
    const res = await appFor().request('/api/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('font-src');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/img-src 'self' data: blob:/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('API の応答は no-store。ルートが no-store を含む指定(private, no-store)を付けていればそのまま', async () => {
    const app = new Hono();
    app.use('*', noStoreApiResponses());
    app.get('/plain', (c) => c.text('x'));
    app.get('/cached', (c) => c.text('x', 200, { 'Cache-Control': 'max-age=60' }));
    app.get('/image', (c) => c.body('x', 200, { 'Cache-Control': 'private, no-store' }));
    expect((await app.request('/plain')).headers.get('cache-control')).toBe('no-store');
    expect((await app.request('/cached')).headers.get('cache-control')).toBe('no-store');
    expect((await app.request('/image')).headers.get('cache-control')).toBe('private, no-store');
  });

  it('画面(静的ファイル)の応答にも同じヘッダーを付け、キャッシュ方針は画面用のまま', async () => {
    const res = await appFor().request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

describe('CSRF対策', () => {
  it('別サイトからの状態変更(Sec-Fetch-Site: cross-site / same-site)は403', async () => {
    const app = appFor();
    for (const site of ['cross-site', 'same-site']) {
      const res = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': site },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'forbidden' });
    }
  });

  it('Sec-Fetch-Site の無い古いブラウザは Origin がホストと違えば403', async () => {
    const res = await appFor().request('http://katahimo.example/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Host: 'katahimo.example' },
    });
    expect(res.status).toBe(403);
  });

  it('同一オリジン・ブラウザ以外(ヘッダー無し)の要求は通す', async () => {
    const app = appFor();
    const sameOrigin = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(sameOrigin.status).toBe(200);
    const sameHost = await app.request('http://katahimo.example/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'http://katahimo.example', Host: 'katahimo.example' },
    });
    expect(sameHost.status).toBe(200);
    expect((await app.request('/api/auth/logout', { method: 'POST' })).status).toBe(200);
  });

  it('GETは対象外', async () => {
    const res = await appFor().request('/api/health', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(200);
  });
});

describe('要求本体の検査', () => {
  it('JSON以外の本体(フォーム送信等)は415', async () => {
    const res = await appFor().request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': '2' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('大きすぎる本体は413(認証系は256KBまで)', async () => {
    const big = JSON.stringify({
      tenantSlug: 'demo',
      email: 'a@example.com',
      password: 'x'.repeat(300 * 1024),
    });
    const res = await appFor().request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(big.length) },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it('JSONの本体は通る(検証エラーは400)', async () => {
    const res = await appFor().request('/api/auth/login', json({}));
    expect(res.status).toBe(400);
  });
});

describe('本番の設定', () => {
  const production = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'f'.repeat(64),
    SECRET_BOX_PROVIDER: 'gcp',
    SECRET_BOX_KMS_KEY: 'projects/p/locations/asia-northeast1/keyRings/katahimo/cryptoKeys/tenant-secrets',
    STORAGE_PROVIDER: 'gcs',
    GCS_BUCKET: 'p-katahimo-receipts',
  };

  it('HSTS を付ける', async () => {
    const res = await appFor(production).request('/api/health');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
  });

  it('ログアウトのCookie削除は __Host- 接頭辞付き(Secure・Path=/・Domainなし)', async () => {
    const res = await appFor(production).request('/api/auth/logout', { method: 'POST' });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-katahimo_session=;/);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain');
  });
});
