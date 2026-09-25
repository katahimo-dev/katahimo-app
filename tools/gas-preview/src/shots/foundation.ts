import type { Page } from 'playwright-core';
import { type Shot, visible } from './types';

/**
 * 土台(ログイン・ヘッダー・下タブ・設定・お知らせ・パスワード)の場面。
 * タブの中身はまだ作っていないため、ヘッダー・下タブの場面ではタブの中身(main)を塗りつぶす。
 */
const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter(visible).first();

const openSettings = async (page: Page) => {
  await button(page, '⚙️ 設定').click();
  await page.waitForTimeout(400);
};

const openAdminDetails = async (page: Page) => {
  await openSettings(page);
  await page.getByText('詳細設定（管理者のみ）').filter(visible).click();
  await page.waitForTimeout(300);
};

const scrollSettingsTo = async (page: Page, text: string) => {
  await page.getByText(text, { exact: true }).filter(visible).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
};

/** タブの中身(まだ作っていない部分) */
const MAIN = ['main > *'];
/** 設定の版数(GAS版は手書きの 1.1.0、新アプリは package.json の version)は比べない */
const VERSION = ['text=/^Ver\\. /'];
/** ダイアログの場面: 背景のタブの中身を消し、版数を塗りつぶす */
const DIALOG = { gas: { hide: MAIN, mask: VERSION }, web: { hide: MAIN, mask: VERSION } };

export const foundationShots: Shot[] = [
  { name: 'login', title: 'ログイン画面', login: 'none' },
  {
    name: 'login-empty-error',
    title: 'ログイン: 未入力で押したとき',
    login: 'none',
    run: async (page) => {
      await button(page, 'ログイン').click();
    },
  },
  {
    name: 'login-password-visible',
    title: 'ログイン: パスワードを見る',
    login: 'none',
    run: async (page) => {
      await page.getByPlaceholder('例）staff@example.com').filter(visible).fill('admin@example.com');
      await page.getByPlaceholder('••••••••').fill('password');
      await button(page, '👁 見る').click();
    },
  },
  {
    name: 'login-wrong-password',
    title: 'ログイン: パスワード違い',
    login: 'none',
    run: async (page) => {
      await page.getByPlaceholder('例）staff@example.com').filter(visible).fill('admin@example.com');
      await page.getByPlaceholder('••••••••').fill('wrong');
      await button(page, 'ログイン').click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'reset-request',
    title: 'パスワード再設定(メールアドレス入力)',
    login: 'none',
    run: async (page) => {
      await button(page, 'パスワードを忘れたときはこちら').click();
    },
  },
  {
    name: 'reset-verify',
    title: 'パスワード再設定(番号と新しいパスワード)',
    login: 'none',
    run: async (page) => {
      await button(page, 'パスワードを忘れたときはこちら').click();
      await page.getByPlaceholder('例）staff@example.com').filter(visible).fill('admin@example.com');
      await button(page, '番号をメールで受け取る').click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'reset-verify-empty-error',
    title: 'パスワード再設定: 未入力で押したとき',
    login: 'none',
    run: async (page) => {
      await button(page, 'パスワードを忘れたときはこちら').click();
      await page.getByPlaceholder('例）staff@example.com').filter(visible).fill('admin@example.com');
      await button(page, '番号をメールで受け取る').click();
      await page.waitForTimeout(600);
      await button(page, 'このパスワードにする').click();
    },
  },
  {
    name: 'shell',
    title: 'ヘッダー・下タブ(管理者、今日の予定タブ)',
    gas: { hide: MAIN },
    web: { hide: MAIN },
  },
  {
    name: 'shell-staff-selector',
    title: '管理者用「表示するスタッフ」(今日の予定タブの上部)',
    gas: { hide: ['#scheduleStaffField ~ *'] },
    web: { hide: ['#tabSchedule > :not(:first-child)'] },
  },
  {
    name: 'shell-past-schedule-tab',
    title: '出勤簿タブに切り替え(下タブの選択表示・スタッフ選択)',
    run: async (page) => {
      await button(page, /出勤簿/).click();
      await page.waitForTimeout(500);
    },
    gas: { hide: ['#pastScheduleStaffField ~ *'] },
    web: { hide: ['#tabPastSchedule > :not(:first-child)'] },
  },
  {
    name: 'shell-large',
    title: 'ヘッダー・下タブ(文字: 大きい)',
    textSize: 'large',
    gas: { hide: MAIN },
    web: { hide: MAIN },
  },
  {
    name: 'shell-xlarge',
    title: 'ヘッダー・下タブ(文字: とても大きい)',
    textSize: 'xlarge',
    gas: { hide: MAIN },
    web: { hide: MAIN },
  },
  {
    name: 'toast-text-size',
    title: '「Aa」ボタンを押したときのお知らせ',
    run: async (page) => {
      await button(page, /^Aa /).click();
      await page.waitForTimeout(400);
    },
    gas: { hide: MAIN },
    web: { hide: MAIN },
  },
  {
    name: 'settings',
    ...DIALOG,
    title: '設定(管理者)',
    run: openSettings,
  },
  {
    name: 'settings-staff',
    title: '設定(一般スタッフ)',
    login: 'staff',
    run: openSettings,
    ...DIALOG,
  },
  {
    name: 'settings-xlarge',
    ...DIALOG,
    title: '設定(文字: とても大きい)',
    textSize: 'xlarge',
    run: openSettings,
  },
  {
    name: 'settings-admin-open',
    ...DIALOG,
    title: '設定: 詳細設定(管理者のみ)を開いたところ',
    run: async (page) => {
      await openAdminDetails(page);
      await scrollSettingsTo(page, '日報・事故報告で使うモデル');
    },
  },
  {
    name: 'settings-admin-bottom',
    ...DIALOG,
    title: '設定: 詳細設定の下のほう(Webhook・ログアウト・版数)',
    run: async (page) => {
      await openAdminDetails(page);
      await scrollSettingsTo(page, 'ログアウト');
    },
  },
  {
    name: 'settings-admin-visible-key',
    ...DIALOG,
    title: '設定: APIキーを「表示」',
    run: async (page) => {
      await openAdminDetails(page);
      await page.getByRole('button', { name: '表示', exact: true }).filter(visible).first().click();
    },
  },
  {
    name: 'settings-admin-loading',
    title: '設定: 詳細設定の読み込み中',
    run: openAdminDetails,
    gas: {
      ...DIALOG.gas,
      mock: {
        delays: {
          getGeminiApiKeyForAdmin: 'never',
          getGeminiModelSettingsForAdmin: 'never',
          getGoogleChatWebhookSettingsForAdmin: 'never',
        },
      },
    },
    web: { ...DIALOG.web, mock: { 'GET /api/settings/admin': { delayMs: 'never' } } },
  },
  {
    name: 'settings-admin-failed',
    title: '設定: 詳細設定の読み込みに失敗(通信エラー)',
    run: async (page) => {
      await openAdminDetails(page);
      await page.waitForTimeout(500);
    },
    gas: {
      ...DIALOG.gas,
      mock: {
        failures: {
          getGeminiApiKeyForAdmin: 'network',
          getGeminiModelSettingsForAdmin: 'network',
          getGoogleChatWebhookSettingsForAdmin: 'network',
        },
      },
    },
    web: { ...DIALOG.web, mock: { 'GET /api/settings/admin': { status: 500, body: {} } } },
  },
  {
    name: 'settings-models-refreshed',
    ...DIALOG,
    title: '設定: 「🔄 最新モデル一覧を取得」のあと',
    run: async (page) => {
      await openAdminDetails(page);
      await button(page, '🔄 最新モデル一覧を取得').click();
      await page.waitForTimeout(600);
      await scrollSettingsTo(page, '日報・事故報告で使うモデル');
    },
  },
  {
    name: 'toast-error-empty-key',
    ...DIALOG,
    title: '失敗のお知らせ(APIキーを空にして保存)',
    run: async (page) => {
      await openAdminDetails(page);
      await page.locator('#settingGeminiApiKey').fill('');
      await button(page, '保存して閉じる').click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'toast-settings-saved',
    title: '設定を保存したときのお知らせ',
    run: async (page) => {
      await openSettings(page);
      await button(page, '保存して閉じる').click();
      await page.waitForTimeout(600);
    },
    gas: { hide: MAIN },
    web: { hide: MAIN },
  },
  {
    name: 'change-password',
    ...DIALOG,
    title: 'パスワード変更',
    run: async (page) => {
      await openSettings(page);
      await button(page, 'パスワード変更').click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'change-password-mismatch',
    ...DIALOG,
    title: 'パスワード変更: 新しいパスワードが一致しない',
    run: async (page) => {
      await openSettings(page);
      await button(page, 'パスワード変更').click();
      await page.waitForTimeout(400);
      await page.locator('#chgCurrentPass').fill('password');
      await page.locator('#chgNewPass').fill('newpassword1');
      await page.locator('#chgConfirmPass').fill('newpassword2');
      await button(page, '変更する').click();
    },
  },
];
