import { resolve } from 'node:path';
import { REPO_ROOT } from './paths';

/**
 * 新アプリ(packages/web)の Vite 開発サーバーを、このプロセスの中で起動する(e2e を1つの
 * コマンドで動かすため)。`--web-url`(または環境変数 KATAHIMO_WEB_URL)を指定したときは起動せず、
 * すでに動いているサーバーを使う。
 */
export const WEB_DIR = resolve(REPO_ROOT, 'packages/web');

export interface WebServerHandle {
  /** 'http://127.0.0.1:<port>'(末尾の / なし) */
  url: string;
  close: () => Promise<void>;
}

export interface WebServerOptions {
  /** 使う(起動済みの)サーバーのURL。null なら Vite を起動する */
  existingUrl: string | null;
  /** 起動する Vite の /api の中継先(e2e が起動した・または動いている API の URL。WEB_API_PROXY_TARGET として渡す) */
  apiProxyTarget?: string;
  /** 起動する Vite のポート(0 = 空いているポート) */
  port?: number;
}

export async function ensureWebServer({
  existingUrl,
  apiProxyTarget,
  port = Number(process.env.WEB_DEV_PORT ?? 0),
}: WebServerOptions): Promise<WebServerHandle> {
  if (existingUrl) {
    const url = existingUrl.replace(/\/$/, '');
    const reachable = await fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (!reachable) {
      throw new Error(
        `新アプリ(${url})に届きません。pnpm --filter @katahimo/web dev を起動するか、--web-url を外して Vite をこのコマンドから起動してください`,
      );
    }
    return { url, close: async () => undefined };
  }

  // vite.config.ts は環境変数で中継先を決める(起動前に入れておく)
  if (apiProxyTarget) process.env.WEB_API_PROXY_TARGET = apiProxyTarget;
  const { createServer } = await import('vite');
  const server = await createServer({
    root: WEB_DIR,
    configFile: resolve(WEB_DIR, 'vite.config.ts'),
    logLevel: 'warn',
    clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: port !== 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}`;
  console.log(`[e2e] 新アプリの開発サーバーを起動しました: ${url}`);
  return { url, close: () => server.close() };
}
