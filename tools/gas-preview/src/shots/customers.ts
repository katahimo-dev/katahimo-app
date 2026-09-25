import type { Page } from 'playwright-core';
import { CUSTOMERS, DATA_VERSION, reservaCustomerDetails } from '../fixtures';
import { type Shot, type Target, userStorageKey, visible } from './types';

/**
 * 「👪 お客様」タブと「お客様の情報」「これまでの記録」の場面(予定・お客様の担当)。
 *
 * GAS版のモックの getData(gasMock.ts)は「住所・連絡先」の列名が仮のものなので、ここでは本物の
 * 顧客CSV(RESERVA)の列名の details(fixtures の reservaCustomerDetails)に差しかえる。
 */
const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter(visible).first();

const wait = (page: Page, ms = 500) => page.waitForTimeout(ms);

const GAS_GET_DATA = {
  cities: [...new Set(CUSTOMERS.map((c) => c.city))].sort(),
  customers: CUSTOMERS.map((c) => ({
    id: c.id,
    name: c.name,
    address: c.address,
    city: c.city,
    lat: c.lat,
    lng: c.lng,
    family: c.family,
    details: reservaCustomerDetails(c),
  })),
  version: DATA_VERSION,
};

/** 全ての場面で使うGAS版モックの差しかえ(場面ごとの mock と合わせる) */
const gasMock = (
  extra: { delays?: Record<string, number | 'never'>; overrides?: Record<string, unknown> } = {},
) => ({
  mock: { delays: extra.delays, overrides: { getData: GAS_GET_DATA, ...extra.overrides } },
});

async function openVisitorsTab(page: Page) {
  await button(page, /お客様$/).click();
  await wait(page);
}

async function search(page: Page, text: string) {
  await openVisitorsTab(page);
  await page.getByPlaceholder('お客様の名前で探す').filter(visible).fill(text);
  await wait(page, 200);
}

/** n 番目(0から)のお客様のカードのボタンを押す */
async function clickCardButton(page: Page, name: string, n: number) {
  await openVisitorsTab(page);
  await page.getByRole('button', { name }).filter(visible).nth(n).click();
  await wait(page, 800);
}

const openDetail = (n: number) => (page: Page) => clickCardButton(page, '👤 お客様の情報', n);
const openHistory = (n: number) => (page: Page) => clickCardButton(page, '📖 これまでの記録', n);

/** ダイアログの中身(スクロールする部分)を一番下まで */
async function scrollDialogToBottom(page: Page, title: string, target: Target) {
  const root =
    target === 'gas'
      ? page.locator(title === 'お客様の情報' ? '#customerDetailModal' : '#customerHistoryModal')
      : page.getByRole('dialog', { name: title });
  await root
    .locator('.overflow-y-auto')
    .first()
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await wait(page, 200);
}

export const customerShots: Shot[] = [
  {
    name: 'customers-list',
    title: 'お客様タブ(一覧)',
    fullPage: true,
    run: openVisitorsTab,
    gas: gasMock(),
  },
  {
    name: 'customers-loading',
    title: 'お客様タブ(一覧の読み込み中。「すべての地域」)',
    run: openVisitorsTab,
    // GAS版は一覧が届く前だと版数を知らないため「新しい情報があります…」を出す(一覧が届かない場面だけの現象)。
    // 見比べの邪魔になるため、この場面では版数の確認に空を返す
    gas: gasMock({ delays: { getData: 'never' }, overrides: { checkDataVersion: '' } }),
    web: { mock: { 'GET /api/customers': { delayMs: 'never' } } },
  },
  {
    name: 'customers-search',
    title: 'お客様タブ: 名前で探す(「高橋」)',
    run: (page) => search(page, '高橋'),
    gas: gasMock(),
  },
  {
    name: 'customers-city',
    title: 'お客様タブ: 地域で絞り込む(世田谷区)',
    run: async (page) => {
      await openVisitorsTab(page);
      await page.locator('#cityFilter').selectOption('世田谷区');
      await wait(page, 200);
    },
    gas: gasMock(),
  },
  {
    name: 'customers-not-found',
    title: 'お客様タブ: 見つからないとき',
    run: (page) => search(page, '山田'),
    gas: gasMock(),
  },
  {
    name: 'customers-empty',
    title: 'お客様タブ: お客様の情報がまだ無いとき',
    run: openVisitorsTab,
    gas: gasMock({ overrides: { getData: { cities: [], customers: [], version: DATA_VERSION } } }),
    web: { mock: { 'GET /api/customers': { body: { customers: [], cities: [] } } } },
  },
  {
    name: 'customers-recent',
    title: 'お客様タブ: 最近日報を書いたお客様が上に来る',
    fullPage: true,
    run: async (page, target) => {
      // 高橋 → 伊藤 の順に最近書いた
      const ids = [CUSTOMERS[2], CUSTOMERS[3]].map((c) => (target === 'gas' ? c?.id : c?.uuid));
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
        key: userStorageKey(target, 'recent_customers'),
        value: JSON.stringify(ids),
      });
      // 並び順は絞り込むたびに読み直す(GAS版 filterCustomers)ので、いったん探して戻す
      await search(page, 'x');
      await page.getByPlaceholder('お客様の名前で探す').filter(visible).fill('');
      await wait(page, 200);
    },
    gas: gasMock(),
  },
  {
    name: 'customer-detail',
    title: 'お客様の情報(お子様・ご家族、住所・連絡先の上のほう)',
    run: openDetail(0),
    gas: gasMock(),
  },
  {
    name: 'customer-detail-bottom',
    title: 'お客様の情報(住所・連絡先の下のほう。地図ボタン)',
    run: async (page) => {
      await openDetail(0)(page);
      await page.getByText('緊急連絡先', { exact: true }).filter(visible).scrollIntoViewIfNeeded();
      await wait(page, 200);
    },
    gas: gasMock(),
  },
  {
    name: 'customer-detail-end',
    title: 'お客様の情報(一番下)',
    run: async (page, target) => {
      await openDetail(0)(page);
      await scrollDialogToBottom(page, 'お客様の情報', target);
    },
    gas: gasMock(),
  },
  {
    name: 'customer-detail-no-family',
    title: 'お客様の情報(ご家族の登録なし)',
    run: openDetail(3),
    gas: gasMock(),
  },
  {
    name: 'customer-history',
    title: 'これまでの記録(日報・ヒヤリハット、PSI/ES)',
    run: openHistory(0),
    gas: gasMock(),
  },
  {
    name: 'customer-history-memo-tab',
    title: 'これまでの記録: 「書いたメモ」のタブ',
    run: async (page) => {
      await openHistory(0)(page);
      await button(page, '書いたメモ').click();
      await wait(page, 200);
    },
    gas: gasMock(),
  },
  {
    name: 'customer-history-parent-tab',
    title: 'これまでの記録: 「保護者に送る文」のタブ',
    run: async (page) => {
      await openHistory(0)(page);
      await button(page, '保護者に送る文').click();
      await wait(page, 200);
    },
    gas: gasMock(),
  },
  {
    name: 'customer-history-bottom',
    title: 'これまでの記録: 下のほう(「さらに前の記録を見る」)',
    run: async (page, target) => {
      await openHistory(0)(page);
      await scrollDialogToBottom(page, 'これまでの記録', target);
    },
    gas: gasMock(),
  },
  {
    name: 'customer-history-more',
    title: 'これまでの記録: 「さらに前の記録を見る」で続きを読んだあと(一番下)',
    run: async (page, target) => {
      await openHistory(0)(page);
      await button(page, 'さらに前の記録を見る').click();
      await wait(page, 800);
      await scrollDialogToBottom(page, 'これまでの記録', target);
    },
    gas: gasMock(),
  },
  {
    name: 'customer-history-empty',
    title: 'これまでの記録: まだ無いとき',
    run: openHistory(1),
    gas: gasMock(),
  },
  {
    name: 'customer-history-loading',
    title: 'これまでの記録: 読み込み中',
    run: openHistory(0),
    gas: gasMock({ delays: { getCustomerReports: 'never' } }),
    web: { mock: { 'GET /api/reports/history': { delayMs: 'never' } } },
  },
  {
    name: 'customer-history-failed',
    title: 'これまでの記録: 読み込めなかったとき',
    run: openHistory(0),
    gas: { mock: { overrides: { getData: GAS_GET_DATA }, failures: { getCustomerReports: 'x' } } },
    web: { mock: { 'GET /api/reports/history': { status: 500, body: { code: 'internal', message: 'x' } } } },
  },
];
