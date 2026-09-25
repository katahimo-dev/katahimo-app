import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { APIRequestContext, BrowserContext, Page } from 'playwright-core';
import { launchChromium } from './browser';
import { installFontCache } from './fontCache';
import { OUT_DIR } from './paths';

/**
 * 実際のAPI・DBにつないだ新アプリを、スマホの大きさ(390×844)で最初から最後まで操作する通し確認。
 * GAS版との見比べ(shoot.ts)とは別に、並行して作った機能をつないだときに壊れていないかを確かめる。
 *
 *   # API(:8080)と web 開発サーバー(:5173)を起動し、pnpm db:migrate && pnpm db:seed 済みであること
 *   cd tools/gas-preview && npx tsx src/e2e.ts
 *   npx tsx src/e2e.ts --web-url http://127.0.0.1:8484 --only '^(login|logout)$'   # 本番ビルドの配信で
 *
 * 各手順の画面を out/e2e/<番号>-<手順>.png に保存し、手順ごとの成否を表にして出す(1つでも失敗なら終了コード1)。
 * 一般スタッフの確認用に、管理者API(POST /api/admin/staff)で「e2e 一般スタッフ」を作る(既にあれば使い回す)。
 * 日報・領収書・出勤簿はDBに書き込まれる(開発用DB向け。本番に向けて動かさないこと)。
 */
// pnpm 11 は `pnpm … shoot -- --only x` の `--` もそのまま渡す。parseArgs は `--` 以降をオプションとして
// 読まないため取り除く
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    'web-url': { type: 'string', default: process.env.KATAHIMO_WEB_URL ?? 'http://127.0.0.1:5173' },
    only: { type: 'string' },
    tenant: { type: 'string', default: process.env.KATAHIMO_LIVE_TENANT ?? 'demo' },
    email: { type: 'string', default: process.env.KATAHIMO_LIVE_EMAIL ?? 'admin@example.com' },
    password: { type: 'string', default: process.env.KATAHIMO_LIVE_PASSWORD ?? 'admin1234' },
  },
});

const WEB_URL = String(values['web-url']).replace(/\/$/, '');
const TENANT = String(values.tenant);
const ADMIN = { email: String(values.email), password: String(values.password) };
const STAFF = { name: 'e2e 一般スタッフ', email: 'e2e-staff@example.com', password: 'e2e-staff-pass1' };
const E2E_DIR = resolve(OUT_DIR, 'e2e');
const VIEWPORT = { width: 390, height: 844 };
const only = values.only ? new RegExp(values.only) : null;

const visible = { visible: true } as const;
const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter(visible).first();
const toast = (page: Page) => page.getByRole('status');
const wait = (page: Page, ms = 400) => page.waitForTimeout(ms);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** お知らせ(トースト)に文言が出るのを待つ */
async function expectToast(page: Page, text: string | RegExp, timeout = 10_000) {
  await toast(page).filter({ hasText: text }).waitFor({ state: 'visible', timeout });
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
    const onConsole = (m: { type(): string; text(): string }) => {
      // 未ログインでの /api/auth/me 等の 401 は想定どおり(ログイン画面を出すための確認)
      if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(m.text());
    };
    const onPageError = (e: Error) => errors.push(e.message);
    const onResponse = (r: { status(): number; url(): string; request(): { method(): string } }) => {
      if (r.status() >= 500) errors.push(`${r.request().method()} ${r.url()} → ${r.status()}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('response', onResponse);
    try {
      const detail = (await fn()) ?? '';
      await wait(page, 300);
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
    data: { name: STAFF.name, email: STAFF.email, isAdmin: false, initialPassword: STAFF.password },
  });
  assert(res.status() === 201, `POST /api/admin/staff が ${res.status()}: ${await res.text()}`);
  return ((await res.json()) as { staff: { id: string } }).staff.id;
}

async function main() {
  mkdirSync(E2E_DIR, { recursive: true });
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
      await page.locator('#generateBtn').click();
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

    await step(page, 'receipt-upload', async () => {
      const jpeg = await makeJpeg(page, `e2e ${Date.now()}`);
      await page
        .locator('#galleryInput')
        .setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: jpeg });
      await wait(page, 1500);
      const { message, uploadedCount } = await clickForResponse<{ message: string; uploadedCount: number }>(
        page,
        'POST',
        '/api/receipts',
        () => button(page, 'この領収書を送る').click(),
      );
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
      const { message, uploadedCount } = await clickForResponse<{ message: string; uploadedCount: number }>(
        page,
        'POST',
        '/api/receipts',
        () => button(page, 'この領収書を送る').click(),
      );
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
              data: { name: 'x', email: 'e2e-denied@example.com', isAdmin: true },
            }),
          ],
          ['GET /api/settings/admin', req.get(`${WEB_URL}/api/settings/admin`)],
          [
            'POST /api/admin/customers/import',
            req.post(`${WEB_URL}/api/admin/customers/import`, { data: {} }),
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
