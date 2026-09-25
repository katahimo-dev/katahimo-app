import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext } from 'playwright-core';
import { TOOL_ROOT } from './paths';

/**
 * Google Fonts(GAS版・新アプリとも BIZ UDPGothic / Zen Maru Gothic を読む)を、ブラウザではなく
 * Node側で取得してディスクにためておき、ブラウザにはそれを返す。
 *
 * - 撮影のたびにフォントの読み込み具合で結果が揺れないようにするため(2回目からはネットに出ない)
 * - この環境のようにブラウザがプロキシの証明書を信頼しない環境でもフォントを使えるようにするため
 *   (Node側は NODE_EXTRA_CA_CERTS と NODE_USE_ENV_PROXY=1 で社内プロキシを通る)
 */
const CACHE_DIR = resolve(TOOL_ROOT, '.cache/fonts');
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

interface CachedResponse {
  status: number;
  contentType: string;
}

export async function installFontCache(context: BrowserContext) {
  mkdirSync(CACHE_DIR, { recursive: true });
  await context.route(FONT_HOSTS, async (route) => {
    const request = route.request();
    const userAgent = request.headers()['user-agent'] ?? '';
    // Google Fonts はブラウザ(User-Agent)によって返すCSSが違うため、キーに含める
    const key = createHash('sha1').update(`${request.url()}\n${userAgent}`).digest('hex');
    const metaPath = resolve(CACHE_DIR, `${key}.json`);
    const bodyPath = resolve(CACHE_DIR, `${key}.body`);
    if (existsSync(metaPath) && existsSync(bodyPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as CachedResponse;
      await route.fulfill({
        status: meta.status,
        contentType: meta.contentType,
        body: readFileSync(bodyPath),
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
      return;
    }
    try {
      const res = await fetch(request.url(), { headers: { 'User-Agent': userAgent } });
      const body = Buffer.from(await res.arrayBuffer());
      const meta: CachedResponse = {
        status: res.status,
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      };
      if (res.ok) {
        writeFileSync(bodyPath, body);
        writeFileSync(metaPath, JSON.stringify(meta));
      }
      await route.fulfill({
        status: meta.status,
        contentType: meta.contentType,
        body,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } catch (e) {
      console.warn(`[gas-preview] フォントを取得できませんでした(${request.url()}): ${String(e)}`);
      await route.abort();
    }
  });
}
