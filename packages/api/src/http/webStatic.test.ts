import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheControlFor, registerWebStatic } from './webStatic';

let distDir: string;

/** vite build(vite-plugin-pwa あり)の出力に近い構成を作る。 */
beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'katahimo-web-dist-'));
  mkdirSync(join(distDir, 'assets'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(distDir, 'assets', 'index-AbC123.js'), 'console.log(1)');
  writeFileSync(join(distDir, 'sw.js'), 'self.addEventListener("fetch",()=>{})');
  writeFileSync(join(distDir, 'manifest.webmanifest'), '{}');
  writeFileSync(join(distDir, 'favicon.svg'), '<svg/>');
});

afterAll(() => rmSync(distDir, { recursive: true, force: true }));

function createTestApp() {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  registerWebStatic(app, distDir);
  app.notFound((c) => c.json({ code: 'not_found' }, 404));
  return app;
}

describe('registerWebStatic', () => {
  it('/api は常にAPI側が応答し、未定義のAPIも index.html にしない', async () => {
    const app = createTestApp();
    expect(await (await app.request('/api/health')).json()).toEqual({ status: 'ok' });
    const missing = await app.request('/api/unknown');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: 'not_found' });
  });

  it('ハッシュ付きアセットは長期キャッシュ、index.html と Service Worker はキャッシュさせない', async () => {
    const app = createTestApp();
    const asset = await app.request('/assets/index-AbC123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const sw = await app.request('/sw.js');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
    const index = await app.request('/');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(await index.text()).toContain('id="root"');
    expect((await app.request('/manifest.webmanifest')).headers.get('cache-control')).toBe('no-cache');
    expect((await app.request('/favicon.svg')).headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('画面のURL(拡張子なし)は index.html を返し、見つからないファイルは 404 にする', async () => {
    const app = createTestApp();
    const page = await app.request('/attendance/2026-09');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(page.headers.get('cache-control')).toBe('no-cache');

    expect((await app.request('/assets/index-OLD999.js')).status).toBe(404);
    expect((await app.request('/../package.json')).status).toBe(404);
  });

  it('GET/HEAD 以外は配信しない', async () => {
    const app = createTestApp();
    expect((await app.request('/', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/', { method: 'HEAD' })).status).toBe(200);
  });

  it('index.html の無いディレクトリを指定したら起動時に落とす', () => {
    expect(() => registerWebStatic(new Hono(), join(distDir, 'assets'))).toThrow(/index\.html/);
  });
});

describe('cacheControlFor', () => {
  it('区切り文字や先頭の / によらず同じ判定になり、workbox のハッシュ付きファイルも長期キャッシュする', () => {
    expect(cacheControlFor('/index.html')).toBe('no-cache');
    expect(cacheControlFor('push-sw.js')).toBe('no-cache');
    expect(cacheControlFor('assets\\x-1.css')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('workbox-9c191d2f.js')).toBe('public, max-age=31536000, immutable');
  });
});
