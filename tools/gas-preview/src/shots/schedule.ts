import type { Page } from 'playwright-core';
import { DEFAULT_NOW_ISO, DEFAULT_TODAY } from '../dates';
import { ADMIN, DATA_VERSION, routeAppointments, STAFF } from '../fixtures';
import { type Shot, type Target, visible } from './types';

/**
 * 「📅 今日の予定」タブの場面(予定・お客様の担当)。
 * データは fixtures.ts の routeAppointments(今日: 訪問3件+事務作業、明日: 訪問1件+イベント)。
 */
const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter(visible).first();

const wait = (page: Page, ms = 500) => page.waitForTimeout(ms);

const noAppointments = { success: true, appointments: [] };

/** GAS版のルートの応答(getRouteForStaffOnDate)を、件名だけ変えて返す */
const routeWithName = (customerName: string) => ({
  success: true,
  appointments: routeAppointments(0).map((a, i) => (i === 0 ? { ...a, customerName } : a)),
});

/** 新アプリのルートの応答(GET /api/schedule/route)を、件名だけ変えて返す */
const webRouteWithName = (customerName: string) => ({
  success: true,
  appointments: routeAppointments(0).map((a, i) => ({
    eventType: a.eventType,
    customerName: i === 0 ? customerName : a.customerName,
    startTime: a.startTime,
    endTime: a.endTime,
    reservaUrl: '',
    moveUrl: a.moveUrl ?? '',
    moveMin: a.moveMin ?? '',
    moveKm: a.moveKm ?? '',
    attendanceUrl: a.attendanceUrl ?? '',
    attendanceMin: a.attendanceMin ?? '',
    attendanceKm: a.attendanceKm ?? '',
    leavingUrl: a.leavingUrl ?? '',
    leavingMin: a.leavingMin ?? '',
    leavingKm: a.leavingKm ?? '',
    customerId: '',
    address: a.address,
  })),
});

/**
 * このブラウザの2時間キャッシュに今日のルートを入れてから、☀️ 今日 を押し直す(キャッシュから出す)。
 * キーはGAS版がスタッフ名、新アプリがスタッフID。
 */
async function loadFromBrowserCache(page: Page, target: Target) {
  const staff = ADMIN;
  const key =
    target === 'gas'
      ? `GAS_SCHEDULE_ROUTE_V2_${staff.name}_${DEFAULT_TODAY}`
      : `katahimo_schedule_route_v1_${staff.id}_${DEFAULT_TODAY}`;
  const name = routeAppointments(0)[0]?.customerName ?? '';
  const res = target === 'gas' ? routeWithName(name) : webRouteWithName(name);
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, value),
    // 1時間前に調べた結果(「09:00 時点」)。撮影の時計(10:00)から数える(Node の本当の時刻で作ると、GAS版と
    // 新アプリを撮る間に分が変わったとき「HH:MM 時点」がずれる)
    { key, value: JSON.stringify({ res, ts: Date.parse(DEFAULT_NOW_ISO) - 60 * 60 * 1000 }) },
  );
  await button(page, '☀️ 今日').click();
  await wait(page);
}

export const scheduleShots: Shot[] = [
  {
    name: 'schedule-today',
    title: '今日の予定(ルートつき・管理者)',
    fullPage: true,
  },
  {
    name: 'schedule-today-staff',
    title: '今日の予定(一般スタッフ。「表示するスタッフ」は出ない)',
    login: 'staff',
    fullPage: true,
  },
  {
    name: 'schedule-tomorrow',
    title: '明日の予定(訪問1件で出勤・退勤の両方+イベント)',
    fullPage: true,
    run: async (page) => {
      await button(page, '🌙 明日').click();
      await wait(page);
    },
  },
  {
    name: 'schedule-other-staff',
    title: '管理者が「表示するスタッフ」で他のスタッフを選んだとき',
    run: async (page) => {
      const other = STAFF[1]?.name ?? '';
      await page.locator('#scheduleStaffSelect').selectOption({ label: other });
      await wait(page);
    },
  },
  {
    name: 'schedule-loading',
    title: 'ルートを調べている間(読み込み中・「調べています…（10秒ほど）」)',
    gas: { mock: { delays: { getRouteForStaffOnDate: 'never' } } },
    web: { mock: { 'GET /api/schedule/route': { delayMs: 'never' } } },
  },
  {
    name: 'schedule-route-failed',
    title: 'ルートを調べられなかったとき(ルートなしの予定だけ出す・赤いお知らせ)',
    fullPage: true,
    gas: { mock: { failures: { getRouteForStaffOnDate: 'Maps quota exceeded' } } },
    web: { mock: { 'GET /api/schedule/route': { status: 500, body: { code: 'internal', message: 'x' } } } },
  },
  {
    name: 'schedule-route-unsuccessful',
    title: 'ルートの応答が success:false のとき(理由を赤いお知らせで出し、ルートなしの予定)',
    fullPage: true,
    gas: {
      mock: {
        overrides: { getRouteForStaffOnDate: { success: false, message: 'カレンダーを読めませんでした' } },
      },
    },
    web: {
      mock: {
        'GET /api/schedule/route': { body: { success: false, message: 'カレンダーを読めませんでした' } },
      },
    },
  },
  {
    name: 'schedule-all-failed',
    title: 'ルートもルートなしの予定も読めなかったとき',
    gas: {
      mock: {
        failures: { getRouteForStaffOnDate: 'x', getScheduleForDate: 'x' },
      },
    },
    web: {
      mock: {
        'GET /api/schedule/route': { status: 500, body: { code: 'internal', message: 'x' } },
        'GET /api/schedule': { status: 500, body: { code: 'internal', message: 'x' } },
      },
    },
  },
  {
    name: 'schedule-empty-today',
    title: '今日の予定が無いとき',
    gas: { mock: { overrides: { getRouteForStaffOnDate: noAppointments } } },
    web: { mock: { 'GET /api/schedule/route': { body: noAppointments } } },
  },
  {
    name: 'schedule-empty-tomorrow',
    title: '明日の予定が無いとき',
    run: async (page) => {
      await button(page, '🌙 明日').click();
      await wait(page);
    },
    gas: { mock: { overrides: { getRouteForStaffOnDate: noAppointments } } },
    web: { mock: { 'GET /api/schedule/route': { body: noAppointments } } },
  },
  {
    name: 'schedule-cached',
    title: 'このブラウザに2時間キャッシュがあるとき(調べずに出す・「09:00 時点」)',
    fullPage: true,
    run: loadFromBrowserCache,
    // キャッシュから出していることが分かるよう、サーバーには聞かない(聞いたら読み込み中のままになる)
    gas: { mock: { delays: { getRouteForStaffOnDate: 'never' } } },
    web: { mock: { 'GET /api/schedule/route': { delayMs: 'never' } } },
  },
  {
    name: 'schedule-refreshing',
    title: '「🔄 最新にする」を押して調べている間(一覧はそのまま)',
    fullPage: true,
    run: async (page, target) => {
      await loadFromBrowserCache(page, target);
      await button(page, '🔄 最新にする').click();
      await wait(page, 300);
    },
    gas: { mock: { delays: { getRouteForStaffOnDate: 'never' } } },
    web: { mock: { 'GET /api/schedule/route': { delayMs: 'never' } } },
  },
  {
    name: 'schedule-report-not-found',
    title: '「この訪問の日報を書く」でお客様を決められないとき(お客様タブへ・探す欄に件名)',
    run: async (page) => {
      await button(page, '✏️ この訪問の日報を書く').click();
      await wait(page);
    },
    gas: { mock: { overrides: { getRouteForStaffOnDate: routeWithName('山田 花子') } } },
    web: { mock: { 'GET /api/schedule/route': { body: webRouteWithName('山田 花子') } } },
  },
  {
    name: 'schedule-report-waiting-customers',
    title: '「この訪問の日報を書く」をお客様の一覧が届く前に押したとき',
    run: async (page) => {
      await button(page, '✏️ この訪問の日報を書く').click();
      await wait(page, 300);
    },
    web: {
      mock: { 'GET /api/customers': { delayMs: 'never' } },
      // 新アプリは届かない要求が残るため、撮る前の待ち(networkidle)が長くなり、4秒で消えるお知らせは
      // 写らない。代わりに押した直後にお知らせが出ていることを確かめる
      run: async (page) => {
        await button(page, '✏️ この訪問の日報を書く').click();
        await page.getByText('お客様の情報を読み込んでいます…').waitFor({ timeout: 2000 });
      },
      hide: ['#toast'],
    },
    gas: {
      mock: { delays: { getData: 'never' }, overrides: { checkDataVersion: '' } },
      hide: ['#toast'],
    },
  },
  {
    name: 'schedule-report-no-customers',
    title: '「この訪問の日報を書く」: お客様の一覧が0件のとき(読み込めませんでした)',
    run: async (page) => {
      await button(page, '✏️ この訪問の日報を書く').click();
      await wait(page, 800);
    },
    gas: { mock: { overrides: { getData: { cities: [], customers: [], version: DATA_VERSION } } } },
    web: { mock: { 'GET /api/customers': { body: { customers: [], cities: [] } } } },
  },
  {
    name: 'schedule-large',
    title: '今日の予定(文字: とても大きい)',
    textSize: 'xlarge',
    fullPage: true,
  },
];
