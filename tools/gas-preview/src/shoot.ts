import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { launchChromium } from './browser';
import { DEFAULT_NOW_ISO, DEFAULT_TODAY } from './dates';
import { ADMIN, STAFF, TENANT } from './fixtures';
import { installFontCache } from './fontCache';
import { startGasServer } from './gasServer';
import { OUT_DIR } from './paths';
import { allShots } from './shots';
import type { GasMockConfig, Shot, Target } from './shots/types';
import { installWebMock } from './webMock';
import { ensureWebServer } from './webServer';

/**
 * GAS版と新アプリを同じ場面で撮影し、out/ に並べた画像を作る。
 *
 *   pnpm --filter @katahimo/gas-preview shoot                 # 全場面(新アプリの Vite もこのコマンドが起動する)
 *   pnpm --filter @katahimo/gas-preview shoot -- --only settings   # 名前に settings を含む場面だけ
 *   pnpm --filter @katahimo/gas-preview shoot -- --list       # 場面の一覧
 *
 * 新アプリは、--web-url(または環境変数 KATAHIMO_WEB_URL)を指定しなければ Vite の開発サーバーを
 * このプロセスの中で起動して使う。指定したときは、そのURLで動いているサーバーを使う。
 * --web-mode mock(既定): /api/** を webMock.ts のモックで返す(APIサーバー不要・GAS版と同じデータ)。
 * --web-mode live: 実際のAPI(Vite経由)にログインして撮る(KATAHIMO_LIVE_EMAIL / KATAHIMO_LIVE_PASSWORD、
 *                  既定は開発用seedの admin@example.com / admin1234)。データはDBの内容になる。
 *
 * 違う画素の割合が --max-diff(既定 0.05%)を越えた場面・撮れなかった場面が1つでもあれば、最後に一覧を出して
 * 終了コード1で終わる。--concurrency で同時に撮る場面の数を変えられる(既定 2)。
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    only: { type: 'string' },
    target: { type: 'string', default: 'both' },
    'web-mode': { type: 'string', default: 'mock' },
    'web-url': { type: 'string', default: process.env.KATAHIMO_WEB_URL },
    'api-url': { type: 'string', default: process.env.WEB_API_PROXY_TARGET ?? 'http://localhost:8080' },
    'max-diff': { type: 'string', default: '0.05' },
    concurrency: { type: 'string', default: '2' },
    'gas-port': { type: 'string', default: process.env.GAS_PREVIEW_PORT ?? '5180' },
    width: { type: 'string', default: '390' },
    height: { type: 'string', default: '844' },
    list: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const VIEWPORT = { width: Number(values.width), height: Number(values.height) };
const MAX_DIFF = Number(values['max-diff']);
const CONCURRENCY = Math.max(1, Number(values.concurrency) || 1);
const WEB_MODE = values['web-mode'] === 'live' ? 'live' : 'mock';
const targets: Target[] =
  values.target === 'gas' ? ['gas'] : values.target === 'web' ? ['web'] : ['gas', 'web'];

/** GAS版のモックの既定(起動直後の「新しい情報があります」が顧客一覧より先に出ないよう、版数確認を遅らせる) */
const GAS_MOCK_DEFAULTS: GasMockConfig = { delays: { checkAndImportLatestCsv: 800 } };

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    isMobile: true,
    hasTouch: true,
  });
  await installFontCache(context);
  // 撮影用ページ以外(例: GAS版の外部リンク)へは出さない
  return context;
}

/** 見比べない部分を消す(レイアウトは変えずに見えなくするだけ) */
async function hide(page: Page, selectors: string[] | undefined) {
  if (!selectors?.length) return;
  await page.addStyleTag({ content: `${selectors.join(',')} { visibility: hidden !important; }` });
}

/**
 * 通信・フォント・画面の動き(フェードなどのCSSの移り変わり)が落ち着くまで待つ。
 * 読み込み中のくるくる(無限にくり返す動き)は待たない。
 */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(ANIMATIONS_FINISHED_SCRIPT, undefined, { timeout: 3000 }).catch(() => undefined);
}

// tsx(esbuild)は関数に __name を差し込むため、ブラウザで動かす処理は文字列で渡す
const ANIMATIONS_FINISHED_SCRIPT = `document.getAnimations().every((a) => {
  const iterations = a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : 1;
  return iterations === Infinity || a.playState !== 'running';
})`;

async function shootGas(browser: Browser, gasUrl: string, shot: Shot, file: string) {
  const context = await newContext(browser);
  const page = await context.newPage();
  const staff = shot.login === 'staff' ? STAFF[1] : ADMIN;
  const mock: GasMockConfig = {
    ...GAS_MOCK_DEFAULTS,
    ...shot.gas?.mock,
    delays: { ...GAS_MOCK_DEFAULTS.delays, ...shot.gas?.mock?.delays },
    overrides: {
      // GAS版は未ログインでも版数を確かめ、版数が '0' 以外だと顧客一覧の読み直し(getData)が
      // セッション無しで失敗して「うまくいきませんでした…」が出てしまう(GAS版の不具合。新アプリは
      // ログイン後にしか確かめない)。見比べの邪魔になるため、未ログインの場面では版数を '0' にする。
      ...(shot.login === 'none' ? { checkDataVersion: '0' } : {}),
      ...shot.gas?.mock?.overrides,
    },
  };
  await page.addInitScript(
    ({ token, textSize, mock }) => {
      localStorage.clear();
      if (textSize) localStorage.setItem('app_text_size', textSize);
      if (token) localStorage.setItem('GAS_AUTH_TOKEN', token);
      (window as unknown as { __GAS_MOCK__: unknown }).__GAS_MOCK__ = mock;
    },
    { token: shot.login === 'none' ? null : (staff?.token ?? null), textSize: shot.textSize ?? null, mock },
  );
  page.on('dialog', (d) => void d.accept());
  await page.clock.setFixedTime(new Date(DEFAULT_NOW_ISO));
  await page.goto(gasUrl);
  await settle(page);
  await (shot.gas?.run ?? shot.run)?.(page, 'gas');
  await settle(page);
  await hide(page, shot.gas?.hide);
  await page.screenshot({
    path: file,
    fullPage: shot.fullPage,
    // 読み込み中のくるくるなど、くり返す動きは初めの形で止めて撮る(撮る瞬間の角度で差分が出ないように)
    animations: 'disabled',
    mask: (shot.gas?.mask ?? []).map((s) => page.locator(s)),
  });
  await context.close();
}

async function shootWeb(browser: Browser, webUrl: string, shot: Shot, file: string) {
  const context = await newContext(browser);
  if (WEB_MODE === 'mock') {
    const user = shot.login === 'none' ? null : shot.login === 'staff' ? (STAFF[1] ?? null) : ADMIN;
    await installWebMock(context, { user, today: DEFAULT_TODAY }, shot.web?.mock);
  } else if (shot.login !== 'none') {
    const res = await context.request.post(`${webUrl}/api/auth/login`, {
      data: {
        tenantSlug: process.env.KATAHIMO_LIVE_TENANT ?? TENANT.slug,
        email: process.env.KATAHIMO_LIVE_EMAIL ?? 'admin@example.com',
        password: process.env.KATAHIMO_LIVE_PASSWORD ?? 'admin1234',
      },
    });
    if (!res.ok())
      throw new Error(`live モードのログインに失敗しました: ${res.status()} ${await res.text()}`);
  }
  const page = await context.newPage();
  await page.addInitScript(
    ({ textSize, tenant }) => {
      localStorage.clear();
      if (textSize) localStorage.setItem('app_text_size', textSize);
      localStorage.setItem('katahimo_last_tenant_slug', tenant);
    },
    { textSize: shot.textSize ?? null, tenant: TENANT.slug },
  );
  page.on('dialog', (d) => void d.accept());
  await page.clock.setFixedTime(new Date(DEFAULT_NOW_ISO));
  await page.goto(`${webUrl}/`);
  await settle(page);
  await (shot.web?.run ?? shot.run)?.(page, 'web');
  await settle(page);
  await hide(page, shot.web?.hide);
  await page.screenshot({
    path: file,
    fullPage: shot.fullPage,
    // 読み込み中のくるくるなど、くり返す動きは初めの形で止めて撮る(撮る瞬間の角度で差分が出ないように)
    animations: 'disabled',
    mask: (shot.web?.mask ?? []).map((s) => page.locator(s)),
  });
  await context.close();
}

/**
 * GAS版・新アプリ・差分(同じなら黒)を横に並べた1枚を作る。
 * @returns 違う画素の割合(%)。色の差がわずかなもの(文字のにじみ等)は数えない
 */
async function compose(
  browser: Browser,
  shot: Shot,
  gasFile: string,
  webFile: string,
  outFile: string,
): Promise<number> {
  const toDataUrl = (f: string) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const gas = toDataUrl(gasFile);
  const web = toDataUrl(webFile);
  const width = VIEWPORT.width;
  const html = `<!doctype html><html><body style="margin:0;background:#fff;font-family:sans-serif">
    <div style="padding:8px 12px;font-size:14px;font-weight:bold">${shot.name} — ${shot.title}</div>
    <div style="display:flex;gap:12px;padding:0 12px 12px;align-items:flex-start">
      <figure style="margin:0"><figcaption style="font-size:12px">GAS版</figcaption><img src="${gas}" style="width:${width}px;border:1px solid #ccc"></figure>
      <figure style="margin:0"><figcaption style="font-size:12px">新アプリ</figcaption><img src="${web}" style="width:${width}px;border:1px solid #ccc"></figure>
      <figure style="margin:0"><figcaption style="font-size:12px">差分(同じところは黒)</figcaption>
        <div style="position:relative;width:${width}px;border:1px solid #ccc;isolation:isolate">
          <img src="${gas}" style="width:100%;display:block">
          <img src="${web}" style="width:100%;position:absolute;left:0;top:0;mix-blend-mode:difference">
        </div></figure>
    </div></body></html>`;
  const page = await browser.newPage({
    viewport: { width: width * 3 + 60, height: 200 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.waitForLoadState('load');
  await page.screenshot({ path: outFile, fullPage: true });
  // tsx(esbuild)は関数に __name を差し込むため、ブラウザで動かす処理は文字列で渡す
  const diffPercent = (await page.evaluate(DIFF_SCRIPT)) as number;
  await page.close();
  return diffPercent;
}

/** 2枚の画像(ページ内の 1枚目と2枚目の img)で、色の差が大きい画素の割合(%)を返すスクリプト。 */
const DIFF_SCRIPT = `(async () => {
  const imgs = [...document.querySelectorAll('figure img')].slice(0, 2);
  await Promise.all(imgs.map((img) => img.decode()));
  const w = Math.max(imgs[0].naturalWidth, imgs[1].naturalWidth);
  const h = Math.max(imgs[0].naturalHeight, imgs[1].naturalHeight);
  const pixels = (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const a = pixels(imgs[0]);
  const b = pixels(imgs[1]);
  let differ = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 48) differ++;
  }
  return (differ / (w * h)) * 100;
})()`;

interface ShotResult {
  name: string;
  /** 違う画素の割合(%)。片方だけ撮ったときは null */
  diff: number | null;
  error?: string;
}

async function shootOne(
  browser: Browser,
  gasUrl: string | null,
  webUrl: string | null,
  shot: Shot,
): Promise<ShotResult> {
  const gasFile = resolve(OUT_DIR, `${shot.name}.gas.png`);
  const webFile = resolve(OUT_DIR, `${shot.name}.web.png`);
  const doGas = gasUrl !== null && shot.gas?.enabled !== false;
  const doWeb = webUrl !== null && shot.web?.enabled !== false;
  try {
    if (doGas && gasUrl) await shootGas(browser, gasUrl, shot, gasFile);
    if (doWeb && webUrl) await shootWeb(browser, webUrl, shot, webFile);
    if (doGas && doWeb) {
      const outFile = resolve(OUT_DIR, `${shot.name}.png`);
      const diff = await compose(browser, shot, gasFile, webFile, outFile);
      const mark = diff > MAX_DIFF ? '✘' : '✔';
      console.log(`${mark} ${shot.name.padEnd(30)} 差分 ${diff.toFixed(2).padStart(6)}%  ${outFile}`);
      return { name: shot.name, diff };
    }
    console.log(`✔ ${shot.name}: ${doGas ? gasFile : webFile}`);
    return { name: shot.name, diff: null };
  } catch (e) {
    const error = e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e);
    console.log(`✘ ${shot.name.padEnd(30)} 撮れませんでした: ${error}`);
    return { name: shot.name, diff: null, error };
  }
}

/** 場面を CONCURRENCY 個ずつ並行して撮る(結果は場面の順に返す) */
async function shootAll(
  browser: Browser,
  gasUrl: string | null,
  webUrl: string | null,
  shots: Shot[],
): Promise<ShotResult[]> {
  const results: ShotResult[] = new Array(shots.length);
  let next = 0;
  const worker = async () => {
    while (next < shots.length) {
      const index = next++;
      results[index] = await shootOne(browser, gasUrl, webUrl, shots[index] as Shot);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, shots.length) }, worker));
  return results;
}

function printSummary(results: ShotResult[]): boolean {
  const failed = results.filter((r) => r.error);
  const over = results.filter((r) => !r.error && r.diff !== null && r.diff > MAX_DIFF);
  const compared = results.filter((r) => r.diff !== null);
  const worst = [...compared].sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0))[0];
  console.log('');
  console.log(
    `${results.length} 場面: 撮れなかった ${failed.length} / 差分が ${MAX_DIFF}% を越えた ${over.length}` +
      (worst ? `(いちばん大きい差分: ${worst.name} ${worst.diff?.toFixed(2)}%)` : ''),
  );
  for (const r of failed) console.log(`  ✘ ${r.name}: ${r.error}`);
  for (const r of over) console.log(`  ✘ ${r.name}: 差分 ${r.diff?.toFixed(2)}%`);
  return failed.length === 0 && over.length === 0;
}

async function main() {
  const only = values.only ? new RegExp(values.only) : null;
  const shots = allShots.filter((s) => !only || only.test(s.name));
  if (values.list) {
    for (const s of allShots) console.log(`${s.name.padEnd(32)} ${s.title}`);
    return;
  }
  if (shots.length === 0) throw new Error('該当する場面がありません(--list で一覧を確認)');

  mkdirSync(OUT_DIR, { recursive: true });
  const gasServer = targets.includes('gas') ? await startGasServer(Number(values['gas-port'])) : null;
  const webServer = targets.includes('web')
    ? await ensureWebServer({
        existingUrl: values['web-url'] ?? null,
        apiProxyTarget: WEB_MODE === 'live' ? String(values['api-url']) : undefined,
      })
    : null;

  const browser = await launchChromium();
  let ok = false;
  try {
    const results = await shootAll(browser, gasServer?.url ?? null, webServer?.url ?? null, shots);
    ok = printSummary(results);
  } finally {
    await browser.close();
    gasServer?.server.close();
    await webServer?.close();
  }
  if (!ok) process.exitCode = 1;
}

await main();
