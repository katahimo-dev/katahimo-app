import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { APIRequestContext, BrowserContext, Locator, Page, Response } from 'playwright-core';
import { ensureApiServer } from './apiServer';
import { launchChromium } from './browser';
import { installFontCache } from './fontCache';
import { OUT_DIR } from './paths';
import { ensureWebServer } from './webServer';

/**
 * 実際のAPI・DBにつないだ新アプリを、スマホの大きさ(390×844)で最初から最後まで操作する通し確認。
 * 並行して作った機能をつないだときに壊れていないかを確かめる。
 *
 *   # pnpm db:migrate && pnpm db:seed 済みであること。API(--api-url、既定 :8080)が動いていなければ起動し、
 *   # 新アプリの Vite もこのコマンドの中で起動する(終わったら両方止める)
 *   cd tools/e2e && npx tsx src/e2e.ts
 *   npx tsx src/e2e.ts --web-url http://127.0.0.1:8484 --only '^(login|logout)$'   # 本番ビルドの配信で
 *
 * 各手順の画面を out/e2e/<番号>-<手順>.png に保存し、手順ごとの成否を表にして出す(1つでも失敗なら終了コード1)。
 * 一般スタッフの確認用に、管理者API(POST /api/admin/staff)で「e2e 一般スタッフ」を作る(既にあれば使い回す)。
 * 日報・領収書・出勤簿はDBに書き込まれる(開発用DB向け。本番に向けて動かさないこと)。
 */
// pnpm 11 は `pnpm … e2e -- --only x` の `--` もそのまま渡す。parseArgs は `--` 以降をオプションとして
// 読まないため取り除く
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    'web-url': { type: 'string', default: process.env.KATAHIMO_WEB_URL },
    'api-url': { type: 'string', default: process.env.WEB_API_PROXY_TARGET ?? 'http://localhost:8080' },
    only: { type: 'string' },
    tenant: { type: 'string', default: process.env.KATAHIMO_LIVE_TENANT ?? 'demo' },
    email: { type: 'string', default: process.env.KATAHIMO_LIVE_EMAIL ?? 'admin@example.com' },
    password: { type: 'string', default: process.env.KATAHIMO_LIVE_PASSWORD ?? 'admin1234' },
  },
});

/** main() で決まる(--web-url の値、または起動した Vite のURL) */
let WEB_URL = '';
const TENANT = String(values.tenant);
const ADMIN = { email: String(values.email), password: String(values.password) };
const STAFF = { name: 'e2e 一般スタッフ', email: 'e2e-staff@example.com', password: 'e2e-staff-pass1' };
/** 業務の記録(削除できないこと)を確かめる用の使い回しスタッフ(固定メール。何度流しても同じ人)。 */
const RECORDS_STAFF = { name: 'e2e 記録ありスタッフ', email: 'e2e-staff-with-records@example.com' };
const E2E_DIR = resolve(OUT_DIR, 'e2e');
const VIEWPORT = { width: 390, height: 844 };
const only = values.only ? new RegExp(values.only) : null;
/** この回に送った領収書の束(uploadBatchId)。古い領収書の画像の 404 と、この回の領収書の画像の 404 を見分ける */
const runUploadBatchIds = new Set<string>();

const visible = { visible: true } as const;
const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter(visible).first();
const toast = (page: Page) => page.locator('#toast');
const wait = (page: Page, ms = 400) => page.waitForTimeout(ms);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** お知らせ(トースト)に文言が出るのを待つ */
async function expectToast(page: Page, text: string | RegExp, timeout = 10_000) {
  await toast(page).filter({ hasText: text }).waitFor({ state: 'visible', timeout });
}

/**
 * 保存のボタン(CSV・Excel)を押し、ブラウザが保存したファイルの中身と名前を返す。画面は `api.download()` で受けてから
 * 保存するため(断られたら理由のお知らせでファイルにしない)、保存できたことのお知らせも待つ。
 */
async function clickForDownload(
  page: Page,
  target: Locator,
  toastText: string,
): Promise<{ buf: Buffer; name: string }> {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), target.click()]);
  const buf = readFileSync(await download.path());
  await expectToast(page, toastText);
  return { buf, name: download.suggestedFilename() };
}

/**
 * ボタンを押し、それで送られたAPI(method + パスの一部)の応答のJSONを返す。
 * 直前の手順のお知らせが4秒間残っているため、お知らせの文言ではなくサーバーの応答で確かめる。
 */
async function clickForResponse<T>(
  page: Page,
  method: string,
  path: string,
  click: () => Promise<void>,
): Promise<T> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() === method,
    { timeout: 20_000 },
  );
  await click();
  const res = await response;
  assert(res.ok(), `${method} ${path} が ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** 日報のダイアログで開いている「佐藤」さんのお客様の ID(API の一覧から)。 */
async function customerIdOfReport(page: Page): Promise<string> {
  const res = await page.request.get(`${WEB_URL}/api/customers`);
  assert(res.ok(), `GET /api/customers が ${res.status()}`);
  const { customers } = (await res.json()) as { customers: { id: string; name: string }[] };
  const target = customers.find((c) => c.name.startsWith('佐藤'));
  assert(target, 'お客様「佐藤」が見つからない');
  return target.id;
}

/** ブラウザの canvas で小さな JPEG を作る(領収書の写真の代わり) */
async function makeJpeg(page: Page, label: string): Promise<Buffer> {
  const dataUrl = await page.evaluate((text) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 480;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, 240, 480);
    ctx.fillStyle = '#333';
    ctx.font = '20px sans-serif';
    ctx.fillText(text, 20, 40);
    for (let y = 80; y < 460; y += 36) ctx.fillRect(20, y, 200, 4);
    return canvas.toDataURL('image/jpeg', 0.8);
  }, label);
  return Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
}

async function newContext(browser: Awaited<ReturnType<typeof launchChromium>>): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    isMobile: true,
    hasTouch: true,
  });
  await installFontCache(context);
  return context;
}

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** 手順を順に実行し、成否と画面を記録する(失敗しても次の手順に進む) */
function createRunner(results: StepResult[]) {
  let n = 0;
  return async function step(page: Page, name: string, fn: () => Promise<string | undefined>) {
    if (only && !only.test(name)) return;
    n += 1;
    const file = resolve(E2E_DIR, `${String(n).padStart(2, '0')}-${name}.png`);
    const errors: string[] = [];
    /** 404 になった領収書の画像の ID(手順の終わりに、この回の領収書かどうかで判定する) */
    const missingReceiptImages: string[] = [];
    /** 画面が読んだ領収書の一覧(ID → uploadBatchId) */
    const receiptLists: Promise<[string, string][]>[] = [];
    const onConsole = (m: { type(): string; text(): string; location(): { url: string } }) => {
      // 未ログインでの /api/auth/me 等の 401 は想定どおり(ログイン画面を出すための確認)
      if (m.type() !== 'error' || /status of 401/.test(m.text())) return;
      const image = /\/api\/receipts\/([^/]+)\/image$/.exec(m.location().url);
      if (image?.[1] && /status of 404/.test(m.text())) {
        missingReceiptImages.push(image[1]);
        return;
      }
      errors.push(m.text());
    };
    const onPageError = (e: Error) => errors.push(e.message);
    const onResponse = (r: Response) => {
      if (r.status() >= 500) errors.push(`${r.request().method()} ${r.url()} → ${r.status()}`);
      if (r.ok() && r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/receipts') {
        receiptLists.push(
          r
            .json()
            .then((body: { receipts: { id: string; uploadBatchId: string }[] }) =>
              body.receipts.map((x): [string, string] => [x.id, x.uploadBatchId]),
            )
            .catch(() => []),
        );
      }
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('response', onResponse);
    try {
      const detail = (await fn()) ?? '';
      await wait(page, 300);
      if (missingReceiptImages.length > 0) {
        const batchOf = new Map((await Promise.all(receiptLists)).flat());
        for (const id of missingReceiptImages) {
          // 使い回している開発用DBでは、別の環境(ファイル置き場)で送った古い領収書の画像が 404 になる(画面は「画像なし」)。
          // 許すのはそれだけで、この回に送った領収書・一覧に無い領収書の画像の 404 は不具合として扱う
          const batch = batchOf.get(id);
          if (batch === undefined || runUploadBatchIds.has(batch)) errors.push(`領収書の画像が 404: ${id}`);
        }
      }
      if (errors.length > 0) throw new Error(`ブラウザのエラー: ${errors.join(' / ')}`);
      results.push({ name, ok: true, detail });
    } catch (e) {
      results.push({
        name,
        ok: false,
        detail: e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e),
      });
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
      await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
    }
  };
}

async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto(`${WEB_URL}/?t=${encodeURIComponent(TENANT)}`);
  await page.getByPlaceholder('例）staff@example.com').filter(visible).fill(email);
  await page.getByPlaceholder('••••••••').filter(visible).fill(password);
  await button(page, 'ログイン').click();
  await button(page, '⚙️ 設定').waitFor({ state: 'visible', timeout: 15_000 });
}

async function logoutViaUi(page: Page) {
  if (!(await button(page, 'ログアウト').isVisible())) {
    await button(page, '⚙️ 設定').click();
    await wait(page);
  }
  await button(page, 'ログアウト').click(); // confirm() は自動で OK
  await page.getByPlaceholder('例）staff@example.com').filter(visible).waitFor({ timeout: 15_000 });
}

async function switchTab(page: Page, label: RegExp) {
  await button(page, label).click();
  await wait(page, 600);
}

/** 管理者のCookieで一般スタッフを用意する(既にあれば使い回す) */
async function ensureStaff(api: APIRequestContext): Promise<string> {
  const list = await api.get(`${WEB_URL}/api/admin/staff`);
  assert(list.ok(), `GET /api/admin/staff が ${list.status()}`);
  const { staff } = (await list.json()) as { staff: { id: string; email: string }[] };
  const existing = staff.find((s) => s.email === STAFF.email);
  if (existing) return existing.id;
  const res = await api.post(`${WEB_URL}/api/admin/staff`, {
    data: { name: STAFF.name, email: STAFF.email, role: 'staff', initialPassword: STAFF.password },
  });
  assert(res.status() === 201, `POST /api/admin/staff が ${res.status()}: ${await res.text()}`);
  return ((await res.json()) as { staff: { id: string } }).staff.id;
}

async function main() {
  mkdirSync(E2E_DIR, { recursive: true });
  // --web-url を指定したときは、その画面(本番ビルドなら API も同じオリジン)をそのまま使う
  const api = values['web-url'] ? null : await ensureApiServer(String(values['api-url']));
  const web = await ensureWebServer({
    existingUrl: values['web-url'] ?? null,
    apiProxyTarget: String(values['api-url']),
  }).catch(async (e: unknown) => {
    await api?.close();
    throw e;
  });
  WEB_URL = web.url;
  try {
    await runJourney();
  } finally {
    await web.close();
    await api?.close();
  }
}

async function runJourney() {
  const results: StepResult[] = [];
  const step = createRunner(results);
  const browser = await launchChromium();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const todayDay = Number(today.slice(8, 10));

  try {
    // ── 管理者 ──
    const context = await newContext(browser);
    const page = await context.newPage();
    page.on('dialog', (d) => void d.accept());
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e_initialized')) {
        localStorage.clear();
        sessionStorage.setItem('e2e_initialized', '1');
      }
    });

    await step(page, 'login', async () => {
      await loginViaUi(page, ADMIN.email, ADMIN.password);
      return `${TENANT} / ${ADMIN.email}`;
    });

    await step(page, 'schedule-empty', async () => {
      await page.getByText('この日の予定はありません').filter(visible).waitFor({ timeout: 15_000 });
      assert(
        await page.locator('#scheduleStaffSelect').isVisible(),
        '管理者なのに「表示するスタッフ」が無い',
      );
      return '📭 この日の予定はありません';
    });

    await step(page, 'customers-search', async () => {
      await switchTab(page, /お客様$/);
      await page.getByPlaceholder('お客様の名前で探す').filter(visible).fill('佐藤');
      await wait(page, 600);
      const cards = page.getByRole('button', { name: '👤 お客様の情報' }).filter(visible);
      const count = await cards.count();
      assert(count >= 1, '「佐藤」で探してもお客様が出ない(pnpm db:seed 済みか確認)');
      return `${count}件`;
    });

    await step(page, 'customer-detail', async () => {
      await button(page, '👤 お客様の情報').click();
      await page.getByRole('dialog', { name: 'お客様の情報' }).waitFor({ timeout: 10_000 });
      await wait(page, 800);
      return undefined;
    });

    await step(page, 'customer-history', async () => {
      await page
        .getByRole('dialog', { name: 'お客様の情報' })
        .getByRole('button', { name: '閉じる' })
        .last()
        .click();
      await wait(page, 500);
      await button(page, '📖 これまでの記録').click();
      await page.getByRole('dialog', { name: 'これまでの記録' }).waitFor({ timeout: 10_000 });
      await wait(page, 800);
      return undefined;
    });

    await step(page, 'report-generate', async () => {
      await page
        .getByRole('dialog', { name: 'これまでの記録' })
        .getByRole('button', { name: '閉じる' })
        .first()
        .click();
      await wait(page, 500);
      await button(page, '✏️ 日報を書く').click();
      await page.locator('#reportInput').waitFor({ state: 'visible', timeout: 10_000 });
      await page.locator('#reportInput').fill('公園で外遊び。お昼ごはんの手伝い。(e2e)');
      // 日報AIの言葉選び: お子様が1人のお客様は最初から選ばれている。ご家庭の★と PSI は AI の前に選ぶ
      const childSelect = page.locator('#dailyAiChild');
      await childSelect.waitFor({ state: 'visible', timeout: 10_000 });
      const childId = await childSelect.inputValue();
      assert(childId !== '', 'お子様が1人なのに日報のお子様が選ばれていない');
      await page.locator('#dailyAiSection').getByRole('radio', { name: '★4' }).waitFor({ timeout: 10_000 });
      const profile = await clickForResponse<{ profile: { educationLevel: number } }>(
        page,
        'PUT',
        new URL(`/api/customers/${await customerIdOfReport(page)}/report-profile`, WEB_URL).pathname,
        () => page.locator('#dailyAiSection').getByRole('radio', { name: '★4' }).click(),
      );
      assert(profile.profile.educationLevel === 4, `ご家庭の★が保存されない: ${JSON.stringify(profile)}`);
      await page.locator('#star-risk').getByRole('radio', { name: '3' }).click();
      const generateRequest = page.waitForRequest(
        (r) => new URL(r.url()).pathname === '/api/reports/daily/generate' && r.method() === 'POST',
      );
      await page.locator('#generateBtn').click();
      const sent = (await generateRequest).postDataJSON() as Record<string, unknown>;
      assert(
        sent.careRecipientId === childId &&
          sent.riskRating === 3 &&
          sent.reportDate === today &&
          sent.customerId,
        `AI に送る日報AIの材料が違う: ${JSON.stringify(sent)}`,
      );
      await page.locator('#warningsArea').filter(visible).waitFor({ timeout: 20_000 });
      const text = (await page.locator('#warningsList').innerText()).trim();
      assert(/API Key/.test(text), `AIキー未設定の知らせが出ない: ${text}`);
      assert(!(await page.locator('#saveBtn').isVisible()), 'AIが失敗したのに保存ボタンが出ている');
      return `知らせ: ${text.replace(/\s+/g, ' ').slice(0, 60)}`;
    });

    await step(page, 'report-save-api', async () => {
      // AIが使えないと画面からは保存できない(GAS版と同じ)ため、同じ入力をAPIで保存する
      const customers = await page.request.get(`${WEB_URL}/api/customers`);
      assert(customers.ok(), `GET /api/customers が ${customers.status()}`);
      const body = (await customers.json()) as { customers: { id: string; name: string }[] };
      const target = body.customers.find((c) => c.name.startsWith('佐藤'));
      assert(target, 'お客様「佐藤」が見つからない');
      const res = await page.request.post(`${WEB_URL}/api/reports/daily`, {
        data: {
          customerId: target.id,
          reportDate: today,
          startTime: '09:00',
          endTime: '11:00',
          inputText: '公園で外遊び。お昼ごはんの手伝い。(e2e)',
          internalText: '【サポート内容】\n公園で外遊び(e2e)',
          customerText: '本日もありがとうございました(e2e)',
        },
      });
      assert(res.ok(), `POST /api/reports/daily が ${res.status()}: ${await res.text()}`);
      return ((await res.json()) as { message?: string }).message ?? '';
    });

    /** この回に送った領収書の束(領収書の一覧の手順で、その画像を開く) */
    let uploadBatchId: string | null = null;
    await step(page, 'receipt-upload', async () => {
      const jpeg = await makeJpeg(page, `e2e ${Date.now()}`);
      await page
        .locator('#galleryInput')
        .setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: jpeg });
      await wait(page, 1500);
      const uploaded = await clickForResponse<{
        message: string;
        uploadedCount: number;
        uploadBatchId: string | null;
      }>(page, 'POST', '/api/receipts', () => button(page, 'この領収書を送る').click());
      const { message, uploadedCount } = uploaded;
      uploadBatchId = uploaded.uploadBatchId;
      if (uploadBatchId) runUploadBatchIds.add(uploadBatchId);
      assert(uploadedCount === 1, `領収書が登録されない: ${message}`);
      await expectToast(page, message);
      return message;
    });

    await step(page, 'standalone-receipt', async () => {
      await page.locator('#reportModal').getByRole('button', { name: '閉じる' }).first().click();
      await wait(page, 600);
      await page.locator('#standaloneReceiptBtn').click();
      await page.locator('#unregisteredCustomerName').filter(visible).waitFor({ timeout: 10_000 });
      await page.locator('#unregisteredCustomerName').fill('e2e 未登録 花子');
      const jpeg = await makeJpeg(page, `e2e standalone ${Date.now()}`);
      await page
        .locator('#galleryInput')
        .setInputFiles({ name: 'receipt2.jpg', mimeType: 'image/jpeg', buffer: jpeg });
      await wait(page, 1500);
      const {
        message,
        uploadedCount,
        uploadBatchId: standaloneBatchId,
      } = await clickForResponse<{
        message: string;
        uploadedCount: number;
        uploadBatchId: string | null;
      }>(page, 'POST', '/api/receipts', () => button(page, 'この領収書を送る').click());
      if (standaloneBatchId) runUploadBatchIds.add(standaloneBatchId);
      assert(uploadedCount === 1, `領収書が登録されない: ${message}`);
      await expectToast(page, message);
      return message;
    });

    await step(page, 'attendance-week-list', async () => {
      await page.locator('#reportModal').getByRole('button', { name: '閉じる' }).first().click();
      await wait(page, 600);
      await switchTab(page, /出勤簿/);
      await page.locator('#calDayHeaderRow').waitFor({ timeout: 15_000 });
      assert(
        await page.locator('#pastScheduleStaffSelect').isVisible(),
        '管理者なのに「表示するスタッフ」が無い',
      );
      assert(await button(page, '📅 まとめて取り込む').isVisible(), '管理者なのに「まとめて取り込む」が無い');
      return undefined;
    });

    await step(page, 'attendance-week-grid', async () => {
      await button(page, '📋 表で見る').click();
      await wait(page);
      await button(page, '📝 一覧で見る').waitFor({ timeout: 5_000 });
      return undefined;
    });

    await step(page, 'attendance-day-today', async () => {
      await page
        .locator('#calDayHeaderRow button')
        .filter({ hasText: new RegExp(`^\\s*\\S\\s*${todayDay}\\s*$`) })
        .first()
        .click();
      await page.locator('#pastScheduleDetailPanel').waitFor({ timeout: 15_000 });
      return today;
    });

    await step(page, 'attendance-slot1-save', async () => {
      await button(page, '✏️ 記録を直す・足す').click();
      await wait(page, 300);
      await button(page, /^[✅➕]\s*1件目の訪問/).click();
      const dialog = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('button', { name: '保存する' }) })
        .last();
      await dialog.getByLabel('お客様・内容').fill('佐藤 花子(e2e)');
      await dialog.getByLabel('始め').fill('09:00');
      await dialog.getByLabel('終わり').fill('11:00');
      const { message } = await clickForResponse<{ message: string }>(
        page,
        'PUT',
        '/api/attendance/day',
        () => dialog.getByRole('button', { name: '保存する' }).click(),
      );
      await expectToast(page, message);
      return message;
    });

    await step(page, 'attendance-weather', async () => {
      await wait(page, 800);
      const panel = page.locator('#pastScheduleDetailPanel');
      // 選ばれているボタンをもう一度押すと外れるため、選ばれていないほうを押す(何度流しても同じ結果にする)
      const sunny = panel.getByRole('button', { name: '晴れ', exact: true }).first();
      const target =
        (await sunny.getAttribute('aria-pressed')) === 'true'
          ? panel.getByRole('button', { name: '曇り', exact: true }).first()
          : sunny;
      await target.click();
      await wait(page, 200);
      const pressed = await target.getAttribute('aria-pressed');
      assert(pressed === 'true', `天候のボタンが選ばれない: aria-pressed=${pressed}`);
      const { message } = await clickForResponse<{ message: string }>(
        page,
        'PUT',
        '/api/attendance/day',
        () => panel.getByRole('button', { name: '保存する' }).click(),
      );
      assert(message === '修正しました。', `天候を変えたのに保存されない: ${message}`);
      await expectToast(page, message);
      return `aria-pressed=${pressed} / ${message}`;
    });

    await step(page, 'attendance-monthly', async () => {
      await button(page, '📊 今月のまとめ').click();
      await page.locator('#attendanceMonthlyMonth').waitFor({ state: 'visible', timeout: 10_000 });
      await wait(page, 1200);
      const text = await page
        .getByRole('dialog')
        .filter({ has: page.locator('#attendanceMonthlyMonth') })
        .innerText();
      assert(text.includes('領収書'), '今月のまとめに領収書の欄が無い');
      return undefined;
    });

    await step(page, 'attendance-monthly-excel', async () => {
      const dialog = page.getByRole('dialog').filter({ has: page.locator('#attendanceMonthlyMonth') });
      const saved: string[] = [];
      for (const name of ['⬇ Excelで保存', '⬇ 全員分をExcelで保存']) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30_000 }),
          dialog.getByRole('button', { name }).click(),
        ]);
        const path = await download.path();
        const buf = readFileSync(path);
        // .xlsx は zip(先頭が PK)
        assert(buf.subarray(0, 2).toString('latin1') === 'PK', `${name} のファイルが .xlsx でない`);
        assert(
          download.suggestedFilename().endsWith('.xlsx'),
          `${name} のファイル名: ${download.suggestedFilename()}`,
        );
        saved.push(`${download.suggestedFilename()}(${buf.length}バイト)`);
        await expectToast(page, 'Excelファイルを保存しました');
      }
      return saved.join(' / ');
    });

    // 今月のまとめから領収書の一覧を開き、この回に送った領収書の画像(サムネイル・拡大)が API から読めることを確かめる
    let adminReceiptId: string | null = null;
    await step(page, 'attendance-receipts', async () => {
      const month = today.slice(0, 7);
      const listed = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/receipts' && r.request().method() === 'GET',
        { timeout: 20_000 },
      );
      await button(page, '🧾 領収書の一覧・画像を見る').click();
      const res = await listed;
      assert(res.ok(), `GET /api/receipts が ${res.status()}`);
      const { summary } = (await res.json()) as { summary: { count: number } };
      assert(summary.count >= 2, `今月の領収書が一覧に出ない: ${summary.count}件`);
      // この回に送った領収書の ID(一覧は新しい順。開発用DBに古い分が多くても探せるように API で引く)
      const mine = await page.request.get(`${WEB_URL}/api/receipts?month=${month}&limit=200`);
      const { receipts } = (await mine.json()) as { receipts: { id: string; uploadBatchId: string }[] };
      adminReceiptId = receipts.find((r) => r.uploadBatchId === uploadBatchId)?.id ?? null;
      assert(adminReceiptId, 'この回に送った領収書が一覧に無い');

      const dialog = page.getByRole('dialog').filter({ has: page.locator('#receiptListMonth') });
      const list = dialog.getByRole('list', { name: '領収書の一覧' });
      await list.waitFor({ timeout: 10_000 });
      const thumbnailSelector = `img[src="/api/receipts/${adminReceiptId}/image"]`;
      const thumbnail = list.locator(thumbnailSelector);
      for (let i = 0; i < 5 && (await thumbnail.count()) === 0; i += 1) {
        await dialog.getByRole('button', { name: 'もっと見る' }).click();
        await wait(page, 800);
      }
      await thumbnail.scrollIntoViewIfNeeded();
      const loaded = (el: Element | null) =>
        el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0;
      await page.waitForFunction(loaded, await thumbnail.elementHandle(), { timeout: 10_000 });
      await list
        .getByRole('button')
        .filter({ has: page.locator(thumbnailSelector) })
        .click();
      const viewer = page.locator('[role="dialog"][aria-labelledby="receiptImageTitle"]');
      await viewer.waitFor({ timeout: 10_000 });
      const large = viewer.getByRole('img', { name: '領収書の画像', exact: true });
      await page.waitForFunction(loaded, await large.elementHandle(), { timeout: 10_000 });
      await viewer.getByRole('button', { name: '閉じる' }).last().click();
      await wait(page, 300);
      // 「⬇ CSVで保存」(表示しているスタッフの月の全件)
      const csv = await clickForDownload(
        page,
        dialog.getByRole('button', { name: '⬇ CSVで保存' }),
        'CSVファイルを保存しました',
      );
      assert(csv.name.endsWith('.csv'), `領収書のCSVのファイル名: ${csv.name}`);
      assert(csv.buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), '領収書のCSVの先頭にBOMが無い');
      await dialog.getByRole('button', { name: '閉じる' }).last().click();
      await wait(page, 300);
      return `${summary.count}件`;
    });

    await step(page, 'settings-text-size', async () => {
      await page
        .getByRole('dialog')
        .filter({ has: page.locator('#attendanceMonthlyMonth') })
        .getByRole('button', { name: '閉じる' })
        .first()
        .click();
      await wait(page, 500);
      await button(page, '⚙️ 設定').click();
      await wait(page);
      await page.getByText('大きい', { exact: true }).filter(visible).click();
      await wait(page, 300);
      const size = await page.evaluate(() => localStorage.getItem('app_text_size'));
      assert(size === 'large', `文字の大きさが保存されない: ${size}`);
      return `app_text_size=${size}`;
    });

    await step(page, 'settings-admin-details', async () => {
      await page.getByText('詳細設定（管理者のみ）').filter(visible).click();
      await page.locator('#settingGeminiApiKey').waitFor({ state: 'visible', timeout: 10_000 });
      await wait(page, 800);
      await page.getByText('ふつう', { exact: true }).filter(visible).click();
      return undefined;
    });

    await step(page, 'settings-notifications-hidden', async () => {
      // VAPID 未設定(.env)のため「通知」欄はサーバー側の設定で出さない
      assert(
        (await page.getByText('翌日の予定を通知する').filter(visible).count()) === 0,
        'VAPID未設定なのに設定に「通知」欄が出ている',
      );
      await button(page, 'キャンセル').click();
      await wait(page, 300);
      return undefined;
    });

    let newStaffId = '';
    const staffSuffix = Date.now();
    const NEW_STAFF = {
      name: 'e2e 追加スタッフ',
      email: `e2e-admin-add-${staffSuffix}@example.com`,
      phone: '090-1234-5678',
      homeAddress: '東京都新宿区西新宿2-8-1',
    };
    let editedPromptBody = '';

    await step(page, 'admin-tab-visible', async () => {
      await switchTab(page, /管理$/);
      await page.getByRole('tab', { name: '👤 スタッフ' }).waitFor({ timeout: 10_000 });
      assert(
        await page.getByRole('tab', { name: '🤖 AIプロンプト' }).isVisible(),
        '管理者なのに「AIプロンプト」タブが無い',
      );
      assert(
        await page.getByRole('tab', { name: '📄 操作ログ' }).isVisible(),
        '管理者なのに「操作ログ」タブが無い',
      );
      return undefined;
    });

    await step(page, 'admin-staff-add', async () => {
      await button(page, '＋ 登録').click();
      const dialog = page.getByRole('dialog', { name: 'スタッフの登録' });
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByLabel('氏名').fill(NEW_STAFF.name);
      await dialog.getByLabel('メールアドレス').fill(NEW_STAFF.email);
      await dialog.getByLabel('自宅住所').fill(NEW_STAFF.homeAddress);
      const { staff } = await clickForResponse<{ staff: { id: string } }>(
        page,
        'POST',
        '/api/admin/staff',
        () => dialog.getByRole('button', { name: '登録する' }).click(),
      );
      newStaffId = staff.id;
      return `${NEW_STAFF.email} (${newStaffId})`;
    });

    await step(page, 'admin-staff-list', async () => {
      await page.getByPlaceholder('氏名・カナ・メールで探す').fill(NEW_STAFF.name);
      await wait(page, 500);
      assert(
        (await page.getByText(NEW_STAFF.name, { exact: true }).filter(visible).count()) >= 1,
        '登録したスタッフが一覧に出ない',
      );
      assert(
        (await page.getByText('自宅住所なし').filter(visible).count()) === 0,
        '自宅住所を入れたのに「自宅住所なし」の表示が出る',
      );
      return undefined;
    });

    await step(page, 'admin-staff-edit', async () => {
      await page
        .getByRole('button', { name: `${NEW_STAFF.name}さんを編集` })
        .filter(visible)
        .click();
      const dialog = page.getByRole('dialog', { name: 'スタッフの編集' });
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByLabel('電話').fill(NEW_STAFF.phone);
      const { staff } = await clickForResponse<{ staff: { phone: string | null } }>(
        page,
        'PATCH',
        `/api/admin/staff/${newStaffId}`,
        () => dialog.getByRole('button', { name: '保存する' }).click(),
      );
      assert(staff.phone === NEW_STAFF.phone, `電話番号が保存されない: ${staff.phone}`);
      await expectToast(page, '保存しました');
      return staff.phone ?? '';
    });

    await step(page, 'admin-staff-delete', async () => {
      await page
        .getByRole('button', { name: `${NEW_STAFF.name}さんを編集` })
        .filter(visible)
        .click();
      const dialog = page.getByRole('dialog', { name: 'スタッフの編集' });
      await dialog.waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: '🗑 このスタッフを削除する' }).click();
      const confirmDialog = page.getByRole('alertdialog');
      await confirmDialog.waitFor({ timeout: 5_000 });
      await clickForResponse(page, 'DELETE', `/api/admin/staff/${newStaffId}`, () =>
        confirmDialog.getByRole('button', { name: '削除する' }).click(),
      );
      await expectToast(page, '削除しました');
      await wait(page, 500);
      assert(
        (await page.getByText(NEW_STAFF.name, { exact: true }).filter(visible).count()) === 0,
        '削除したのに一覧に残っている',
      );
      return undefined;
    });

    await step(page, 'admin-staff-delete-conflict', async () => {
      // 記録のあるスタッフ(固定メール。前回までの流したぶんで既にいれば使い回す)を用意する
      const list = await page.request.get(`${WEB_URL}/api/admin/staff`);
      assert(list.ok(), `GET /api/admin/staff が ${list.status()}`);
      const { staff: allStaff } = (await list.json()) as { staff: { id: string; email: string }[] };
      let recordsStaffId = allStaff.find((s) => s.email === RECORDS_STAFF.email)?.id;
      if (!recordsStaffId) {
        const created = await page.request.post(`${WEB_URL}/api/admin/staff`, {
          data: { name: RECORDS_STAFF.name, email: RECORDS_STAFF.email, role: 'staff' },
        });
        assert(
          created.status() === 201,
          `POST /api/admin/staff が ${created.status()}: ${await created.text()}`,
        );
        recordsStaffId = ((await created.json()) as { staff: { id: string } }).staff.id;
      }
      // このスタッフの名義で日報を1件作る(業務の記録があると削除できなくなる)
      const customers = await page.request.get(`${WEB_URL}/api/customers`);
      assert(customers.ok(), `GET /api/customers が ${customers.status()}`);
      const { customers: customerList } = (await customers.json()) as {
        customers: { id: string; name: string }[];
      };
      const target = customerList.find((c) => c.name.startsWith('佐藤'));
      assert(target, 'お客様「佐藤」が見つからない');
      const report = await page.request.post(`${WEB_URL}/api/reports/daily`, {
        data: {
          staffId: recordsStaffId,
          customerId: target.id,
          reportDate: '2020-01-15',
          startTime: '09:00',
          endTime: '10:00',
          inputText: '(e2e 削除できないことの確認用)',
          internalText: '(e2e)',
          customerText: '(e2e)',
        },
      });
      assert(report.ok(), `POST /api/reports/daily が ${report.status()}: ${await report.text()}`);
      const del = await page.request.delete(`${WEB_URL}/api/admin/staff/${recordsStaffId}`);
      assert(del.status() === 409, `記録のあるスタッフの削除が409でない: ${del.status()}`);
      const body = (await del.json()) as { message: string };
      assert(/記録があるため削除できません/.test(body.message), `409の文言が想定と違う: ${body.message}`);
      return body.message;
    });

    await step(page, 'admin-prompts-edit', async () => {
      await page.getByRole('tab', { name: '🤖 AIプロンプト' }).click();
      await wait(page, 600);
      const item = page
        .locator('li')
        .filter({ has: page.locator('textarea') })
        .first();
      await item.waitFor({ timeout: 10_000 });
      const textarea = item.locator('textarea');
      const original = await textarea.inputValue();
      editedPromptBody = `${original}\n(e2e 追記 ${Date.now()})`;
      await textarea.fill(editedPromptBody);
      const { prompts } = await clickForResponse<{ prompts: { key: string; body: string }[] }>(
        page,
        'PUT',
        '/api/settings/admin/prompts',
        () => button(page, /保存する/).click(),
      );
      assert(
        prompts.some((p) => p.body === editedPromptBody),
        'プロンプトの保存内容が一致しない',
      );
      return undefined;
    });

    await step(page, 'admin-prompts-reload-shows-edit', async () => {
      await button(page, '🔄 読み込み直す').click();
      await wait(page, 800);
      const item = page
        .locator('li')
        .filter({ has: page.locator('textarea') })
        .first();
      const value = await item.locator('textarea').inputValue();
      assert(value === editedPromptBody, '読み込み直しても保存した内容が出ない');
      return undefined;
    });

    await step(page, 'admin-prompts-reset-default', async () => {
      const item = page
        .locator('li')
        .filter({ has: page.locator('textarea') })
        .first();
      await item.getByRole('button', { name: '既定に戻す' }).click();
      const { prompts } = await clickForResponse<{
        prompts: { key: string; body: string; defaultBody: string }[];
      }>(page, 'PUT', '/api/settings/admin/prompts', () => button(page, /保存する/).click());
      const first = prompts[0];
      assert(!!first && first.body === first.defaultBody, '既定に戻したのに保存内容が既定と違う');
      return undefined;
    });

    await step(page, 'admin-report-ai-list', async () => {
      await page.getByRole('tab', { name: '🧩 日報AIの調整' }).click();
      await wait(page, 600);
      // 取込むファイルの材料にする行(何度流しても同じ ID の1行)
      const created = await page.request.post(`${WEB_URL}/api/admin/report-ai/keywords`, {
        data: {
          row: {
            code: 'E2E1',
            keyword: 'e2e の語',
            ageFromMonths: 0,
            ageToMonths: 84,
            educationLevelMin: 2,
            educationLevelMax: 5,
            psiMin: 3,
            parentExplanation: 'e2e の説明',
          },
        },
      });
      assert(
        created.status() === 201 || created.status() === 409,
        `キーワードを足せない: ${created.status()}`,
      );
      // 表示を切り替えると読み直す
      await page.getByRole('tab', { name: '📋 報告一覧' }).click();
      await wait(page, 400);
      await page.getByRole('tab', { name: '🧩 日報AIの調整' }).click();
      const list = page.getByRole('list', { name: 'キーワード' });
      await list.getByRole('button', { name: /E2E1 e2e の語/ }).waitFor({ timeout: 10_000 });
      return undefined;
    });

    await step(page, 'admin-report-ai-import', async () => {
      // 書き出した xlsx(お客様のマスターと同じ見出しの形)を画面から取り込む
      const exported = await page.request.get(`${WEB_URL}/api/admin/report-ai/export.xlsx`);
      assert(exported.ok(), `書き出しが ${exported.status()}`);
      await page.getByRole('tab', { name: '取込・書き出し' }).click();
      const input = page.locator('#reportAiImportFile');
      await input.waitFor({ timeout: 10_000 });
      const xlsx = Buffer.from(await exported.body());
      const preview = await clickForResponse<{
        dryRun: boolean;
        errors: unknown[];
        counts: { keywords: { rows: number } };
      }>(page, 'POST', '/api/admin/report-ai/import', () =>
        input.setInputFiles({
          name: '日報キーワード表現マスター.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: xlsx,
        }),
      );
      assert(preview.dryRun && preview.errors.length === 0, `確かめの結果が違う: ${JSON.stringify(preview)}`);
      await page.locator('#reportAiImportPreview').waitFor({ timeout: 10_000 });
      await button(page, '反映する').click();
      await expectToast(page, '取り込みました');
      return `キーワード ${preview.counts.keywords.rows}行`;
    });

    await step(page, 'admin-logs-list', async () => {
      await page.getByRole('tab', { name: '📄 操作ログ' }).click();
      await wait(page, 600);
      await page.getByRole('list', { name: '操作ログ' }).waitFor({ timeout: 10_000 });
      await wait(page, 500);
      const text = await page.getByRole('list', { name: '操作ログ' }).innerText();
      assert(text.includes('スタッフの登録'), '操作ログに「スタッフの登録」が出ない');
      assert(text.includes('スタッフ情報の変更'), '操作ログに「スタッフ情報の変更」が出ない');
      assert(text.includes('スタッフの削除'), '操作ログに「スタッフの削除」が出ない');
      return undefined;
    });

    await step(page, 'admin-logs-csv', async () => {
      const { buf, name } = await clickForDownload(
        page,
        page.getByRole('button', { name: '⬇ CSVで保存' }),
        'CSVファイルを保存しました',
      );
      assert(name.endsWith('.csv'), `操作ログのCSVのファイル名: ${name}`);
      assert(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'CSVの先頭にBOMが無い');
      const firstLine = buf.toString('utf8').split('\r\n')[0] ?? '';
      assert(
        firstLine.includes('日時') && firstLine.includes('操作') && firstLine.includes('レベル'),
        `CSVのヘッダーが想定と違う: ${firstLine}`,
      );
      return `${buf.length}バイト`;
    });

    await step(page, 'admin-reports-list', async () => {
      await page.getByRole('tab', { name: '📋 報告一覧' }).click();
      await wait(page, 600);
      const list = page.getByRole('list', { name: '報告一覧' });
      await list.waitFor({ timeout: 10_000 });
      await wait(page, 500);
      const text = await list.innerText();
      assert(text.includes('公園で外遊び(e2e)'), '報告一覧に今日保存した日報が出ない');
      return undefined;
    });

    await step(page, 'admin-reports-detail', async () => {
      await page
        .getByRole('list', { name: '報告一覧' })
        .getByRole('button', { name: /公園で外遊び\(e2e\)/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: '報告の中身' });
      await dialog.getByText('本日もありがとうございました(e2e)').waitFor({ timeout: 10_000 });
      await dialog.getByRole('button', { name: '閉じる' }).last().click();
      await wait(page, 500);
      return undefined;
    });

    await step(page, 'admin-reports-csv', async () => {
      const { buf, name } = await clickForDownload(
        page,
        page.getByRole('button', { name: '⬇ 日報のCSV' }),
        'CSVファイルを保存しました',
      );
      assert(name.endsWith('.csv'), `日報のCSVのファイル名: ${name}`);
      assert(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'CSVの先頭にBOMが無い');
      const [header = '', ...rows] = buf.toString('utf8').trimEnd().split('\r\n');
      assert(
        header.includes('事務局に送る文') && header.includes('記録ID'),
        `CSVのヘッダーが想定と違う: ${header}`,
      );
      assert(
        rows.some((r) => r.includes('本日もありがとうございました(e2e)')),
        'CSVに今日保存した日報が無い',
      );
      return `${rows.length}行`;
    });

    // 一般スタッフの用意(管理者のCookieで)
    const staffId = await ensureStaff(page.request).catch((e: unknown) => {
      results.push({ name: 'create-staff', ok: false, detail: e instanceof Error ? e.message : String(e) });
      return null;
    });
    const adminMe = (await (await page.request.get(`${WEB_URL}/api/auth/me`)).json()) as {
      staff: { staffId: string };
    };

    await step(page, 'logout', async () => {
      await logoutViaUi(page);
      const me = await page.request.get(`${WEB_URL}/api/auth/me`);
      assert(me.status() === 401, `ログアウト後の /api/auth/me が ${me.status()}`);
      return undefined;
    });
    await context.close();

    // ── 一般スタッフ ──
    if (staffId) {
      const staffContext = await newContext(browser);
      const staffPage = await staffContext.newPage();
      staffPage.on('dialog', (d) => void d.accept());

      await step(staffPage, 'staff-login', async () => {
        await loginViaUi(staffPage, STAFF.email, STAFF.password);
        await wait(staffPage, 800);
        assert(
          !(await staffPage.locator('#scheduleStaffSelect').isVisible()),
          '一般スタッフに「表示するスタッフ」が出ている',
        );
        return STAFF.email;
      });

      await step(staffPage, 'staff-attendance-no-admin-ui', async () => {
        assert(!(await button(staffPage, /管理$/).isVisible()), '一般スタッフに「🛠 管理」タブが出ている');
        await switchTab(staffPage, /出勤簿/);
        await staffPage.locator('#calDayHeaderRow').waitFor({ timeout: 15_000 });
        assert(
          !(await staffPage.locator('#pastScheduleStaffSelect').isVisible()),
          '「表示するスタッフ」が出ている',
        );
        assert(
          !(await button(staffPage, '📅 まとめて取り込む').isVisible()),
          '「まとめて取り込む」が出ている',
        );
        return undefined;
      });

      await step(staffPage, 'staff-settings-no-admin-ui', async () => {
        await button(staffPage, '⚙️ 設定').click();
        await wait(staffPage);
        assert(
          (await staffPage.getByText('詳細設定（管理者のみ）').filter(visible).count()) === 0,
          '一般スタッフに「詳細設定（管理者のみ）」が出ている',
        );
        await button(staffPage, 'キャンセル').click();
        return undefined;
      });

      await step(staffPage, 'staff-admin-api-403', async () => {
        const req = staffPage.request;
        const checks: [string, Promise<{ status(): number }>][] = [
          ['GET /api/admin/staff', req.get(`${WEB_URL}/api/admin/staff`)],
          [
            'POST /api/admin/staff',
            req.post(`${WEB_URL}/api/admin/staff`, {
              data: { name: 'x', email: 'e2e-denied@example.com', role: 'admin' },
            }),
          ],
          ['GET /api/settings/admin', req.get(`${WEB_URL}/api/settings/admin`)],
          ['GET /api/admin/audit-logs', req.get(`${WEB_URL}/api/admin/audit-logs`)],
          ['GET /api/admin/report-ai', req.get(`${WEB_URL}/api/admin/report-ai`)],
          [
            'POST /api/admin/report-ai/import',
            req.post(`${WEB_URL}/api/admin/report-ai/import`, { data: { fileBase64: 'eA==', dryRun: true } }),
          ],
          ['GET /api/reports/export.csv', req.get(`${WEB_URL}/api/reports/export.csv?sheet=daily`)],
          ['DELETE /api/admin/staff/:id', req.delete(`${WEB_URL}/api/admin/staff/${staffId}`)],
          [
            'POST /api/admin/customers/import',
            req.post(`${WEB_URL}/api/admin/customers/import`, { data: {} }),
          ],
          [
            'GET /api/attendance/export/all',
            req.get(`${WEB_URL}/api/attendance/export/all?month=${today.slice(0, 7)}`),
          ],
          [
            'POST /api/attendance/day/aggregate/refresh',
            req.post(`${WEB_URL}/api/attendance/day/aggregate/refresh`, {
              data: { date: today, staffId: adminMe.staff.staffId },
            }),
          ],
        ];
        const statuses: string[] = [];
        for (const [label, p] of checks) {
          const status = (await p).status();
          statuses.push(`${label}=${status}`);
          assert(status === 403, `${label} が 403 でない: ${status}`);
        }
        // 他人の staffId を指定しても本人のデータになる(admin-vs-self)
        const day = await req.get(
          `${WEB_URL}/api/attendance/day?date=${today}&staffId=${adminMe.staff.staffId}`,
        );
        assert(day.ok(), `GET /api/attendance/day が ${day.status()}`);
        const { attendance } = (await day.json()) as { attendance: { staffId: string } };
        assert(
          attendance.staffId === staffId,
          `他人の staffId で他人の出勤簿が見えた: ${attendance.staffId}`,
        );
        return `${statuses.join(', ')}; staffId 指定は無視(本人)`;
      });

      await step(staffPage, 'staff-receipts-own-only', async () => {
        const req = staffPage.request;
        const month = today.slice(0, 7);
        const all = await req.get(`${WEB_URL}/api/receipts?month=${month}&allStaff=true`);
        assert(all.status() === 403, `一般スタッフの全員分の領収書が ${all.status()}`);
        const csv = await req.get(`${WEB_URL}/api/receipts/csv?month=${month}`);
        assert(csv.status() === 403, `一般スタッフの領収書のCSVが ${csv.status()}`);
        // 他人の staffId を指定しても本人の一覧になる(admin-vs-self)
        const own = await req.get(`${WEB_URL}/api/receipts?month=${month}&staffId=${adminMe.staff.staffId}`);
        assert(own.ok(), `GET /api/receipts が ${own.status()}`);
        const { staff } = (await own.json()) as { staff: { id: string } | null };
        assert(staff?.id === staffId, `他人の staffId で他人の領収書が見えた: ${staff?.id}`);
        if (adminReceiptId) {
          const image = await req.get(`${WEB_URL}/api/receipts/${adminReceiptId}/image`);
          assert(image.status() === 403, `他人の領収書の画像が ${image.status()}`);
        }
        return adminReceiptId ? '全員分・CSV・他人の画像は 403' : '全員分・CSV は 403(画像は未確認)';
      });

      await step(staffPage, 'staff-logout', async () => {
        await logoutViaUi(staffPage);
        return undefined;
      });
      await staffContext.close();
    }
  } finally {
    await browser.close();
  }

  console.log('');
  for (const r of results) console.log(`${r.ok ? '✔' : '✘'} ${r.name.padEnd(30)} ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 手順が成功(画面: ${E2E_DIR})`);
  if (failed > 0) process.exitCode = 1;
}

await main();
