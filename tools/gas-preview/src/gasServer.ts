import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { buildGasTailwindCss } from './gasCss';
import { gasHandlers } from './gasMock';
import { GAS_INDEX_HTML, TOOL_ROOT } from './paths';

/**
 * GAS版 index.html をローカルで開けるようにするサーバー。
 * - `<script src="https://cdn.tailwindcss.com">` を、事前に作ったCSS(/__gas/tailwind.css)と
 *   google.script.run のモック(/__gas/google-script-run-mock.js)に差しかえて返す。
 * - `POST /__gas/run/<関数名>` で gasMock.ts のモック関数を呼ぶ。
 * index.html 自体(submodule)は書きかえない。
 */
const TAILWIND_CDN_TAG = '<script src="https://cdn.tailwindcss.com"></script>';

export async function startGasServer(port: number): Promise<{ server: Server; url: string }> {
  const original = readFileSync(GAS_INDEX_HTML, 'utf8');
  if (!original.includes(TAILWIND_CDN_TAG)) {
    throw new Error('GAS版 index.html に Tailwind CDN の <script> が見つかりません(差しかえ位置が変わった?)');
  }
  const html = original.replace(
    TAILWIND_CDN_TAG,
    '<link rel="stylesheet" href="/__gas/tailwind.css">\n    <script src="/__gas/google-script-run-mock.js"></script>',
  );
  const css = await buildGasTailwindCss(original);
  const mockJs = readFileSync(resolve(TOOL_ROOT, 'browser/google-script-run-mock.js'), 'utf8');

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__gas/tailwind.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(css);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__gas/google-script-run-mock.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(mockJs);
      return;
    }
    const run = url.pathname.match(/^\/__gas\/run\/([A-Za-z0-9_]+)$/);
    if (req.method === 'POST' && run) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const name = run[1] as string;
        const { args = [], today } = JSON.parse(body || '{}') as { args?: unknown[]; today: string };
        const handler = gasHandlers[name];
        let payload: { value?: unknown; error?: string };
        if (!handler) {
          console.warn(
            `[gas-preview] モックの無い関数が呼ばれました: ${name} (src/gasMock.ts に追加してください)`,
          );
          payload = { error: `モックの無い関数です: ${name}` };
        } else {
          try {
            payload = { value: handler(args, { today }) ?? null };
          } catch (e) {
            payload = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  return { server, url: `http://127.0.0.1:${port}/` };
}
