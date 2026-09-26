import { existsSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

/** ハッシュ付きファイル名(Vite の build.assetsDir)。内容が変わればURLも変わるため長期キャッシュできる。 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** 毎回サーバーに再検証させる(ETag/Last-Modified が無いため実質毎回取得。いずれも小さいファイル)。 */
const NO_CACHE = 'no-cache';
/** ハッシュの付かない静的ファイル(アイコン等)。更新が数時間で行き渡れば十分なもの。 */
const SHORT_CACHE = 'public, max-age=3600';

/**
 * 更新をすぐ端末に届ける必要があるファイル。index.html は参照するアセットのハッシュが変わるため、
 * Service Worker(vite-plugin-pwa の sw.js と、sw.js が読む通知の処理 push-sw.js)と登録スクリプト・マニフェストは、
 * キャッシュされると古い版のアプリが端末に残り続けるため、いずれもキャッシュさせない。
 */
const ALWAYS_REVALIDATE = new Set([
  'index.html',
  'sw.js',
  'push-sw.js',
  'registerSW.js',
  'manifest.webmanifest',
]);

/** 配信するファイルのパス(distDir からの相対、`/` 区切り)に付ける Cache-Control。 */
export function cacheControlFor(relativePath: string): string {
  const path = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (ALWAYS_REVALIDATE.has(path)) return NO_CACHE;
  // assets/ は Vite、workbox-<hash>.js は vite-plugin-pwa が内容のハッシュをファイル名に付ける
  if (path.startsWith('assets/') || /^workbox-[0-9a-f]+\.js$/.test(path)) return IMMUTABLE_CACHE;
  return SHORT_CACHE;
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/**
 * ビルド済みのWeb画面(packages/web の vite build 出力)を API と同じサービスから配信する
 * (本番の Cloud Run。同一オリジンにしてセッションCookieをそのまま使うため)。
 *
 * - `/api/*` は常にAPI側が優先(APIのルートを先に登録し、ここでは `/api` を素通りさせる)。
 * - 存在するファイルはそのまま返し、パスに応じた Cache-Control を付ける(cacheControlFor)。
 * - 拡張子の無いパス(`/attendance` 等の画面のURL)は index.html を返す(SPA フォールバック)。
 *   拡張子のあるパスで見つからないもの(古いハッシュの JS 等)は 404 のまま返し、HTMLを JS として
 *   読ませないようにする。
 *
 * 開発時は Vite の開発サーバーが画面を配信するため使わない(WEB_DIST_DIR 未設定)。
 */
export function registerWebStatic(app: Hono, distDir: string): void {
  const absoluteDir = resolve(distDir);
  if (!existsSync(join(absoluteDir, 'index.html'))) {
    throw new Error(
      `WEB_DIST_DIR に index.html がありません: ${absoluteDir}(pnpm --filter @katahimo/web build)`,
    );
  }
  // serveStatic の root はカレントディレクトリからの相対パスで指定する仕様のため変換する
  const root = relative(process.cwd(), absoluteDir) || '.';
  const files = serveStatic({ root });
  const indexHtml = serveStatic({ root, path: 'index.html' });

  // serveStatic の onFound はレスポンスを作った後に呼ばれ、そこで c.header() しても反映されないため、
  // 返ってきたレスポンスに直接付ける(見つからず next() に進んだ場合は Response 以外が返る)。
  app.on(['GET', 'HEAD'], '*', async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    const res = await files(c, next);
    const requested = c.req.path.endsWith('/') ? `${c.req.path}index.html` : c.req.path;
    if (res instanceof Response) res.headers.set('Cache-Control', cacheControlFor(requested));
    return res;
  });
  app.on(['GET', 'HEAD'], '*', async (c, next) => {
    if (isApiPath(c.req.path) || extname(c.req.path) !== '') return next();
    const res = await indexHtml(c, next);
    if (res instanceof Response) res.headers.set('Cache-Control', NO_CACHE);
    return res;
  });
}
