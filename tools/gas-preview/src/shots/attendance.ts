import type { Page } from 'playwright-core';
import { type Shot, visible } from './types';

/**
 * 出勤簿タブ(週間予定・1日表示・予定の修正・移動と距離・カレンダーと違うところ・まとめて取り込む・
 * 今月のまとめ)の場面。「今日」は 2026-09-25(金)。この週(9/20〜9/26)は月〜金に記録がある。
 * GAS版と新アプリで文言・並びが同じなので、操作はほぼ両方に共通で書ける。
 */
const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter(visible).first();

const wait = (page: Page, ms = 400) => page.waitForTimeout(ms);

const openTab = async (page: Page) => {
  await button(page, /出勤簿/).click();
  await wait(page, 600);
};

/** 日付の行のボタン(「金」「25」) */
const dateButton = (page: Page, dow: string, day: number) =>
  page
    .locator('#calDayHeaderRow button')
    .filter({ hasText: new RegExp(`^\\s*${dow}\\s*${day}\\s*$`) })
    .first();

const openDay = async (page: Page, dow: string, day: number) => {
  await openTab(page);
  await dateButton(page, dow, day).click();
  await wait(page, 600);
};

const openMenuItem = async (page: Page, label: string) => {
  await button(page, '✏️ 記録を直す・足す').click();
  await wait(page, 200);
  await button(page, new RegExp(`^[✅➕]\\s*${label.replace(/[（）]/g, '.')}`)).click();
  await wait(page, 400);
};

const openMonthly = async (page: Page) => {
  await openTab(page);
  await button(page, '📊 今月のまとめ').click();
  await wait(page, 800);
};

const openRangeSync = async (page: Page) => {
  await openTab(page);
  await button(page, '📅 まとめて取り込む').click();
  await wait(page, 300);
};

/** 取り込み中・終わった場面では「表示するスタッフ」の1人だけにチェックする(件数を少なくする) */
const checkOnlyFirstStaff = async (page: Page) => {
  await button(page, '全部はずす').click();
  await page.getByRole('checkbox').filter(visible).first().check();
};

export const attendanceShots: Shot[] = [
  {
    name: 'att-week-list',
    title: '出勤簿: 週の一覧(予定のある日だけ・今日の枠)',
    fullPage: true,
    run: openTab,
  },
  {
    name: 'att-week-grid',
    title: '出勤簿: 週の表(📋 表で見る)',
    fullPage: true,
    run: async (page) => {
      await openTab(page);
      await button(page, '📋 表で見る').click();
      await wait(page);
    },
  },
  {
    name: 'att-week-empty',
    title: '出勤簿: 予定の無い週(📭)',
    fullPage: true,
    run: async (page) => {
      await openTab(page);
      await button(page, '次の週 ▶').click();
      await wait(page, 600);
    },
  },
  {
    name: 'att-week-loading',
    title: '出勤簿: 週間予定の読み込み中',
    run: openTab,
    gas: { mock: { delays: { getWeeklyScheduleForStaff: 'never' } } },
    web: { mock: { 'GET /api/attendance/week': { delayMs: 'never' } } },
  },
  {
    name: 'att-staff',
    title: '出勤簿: 一般スタッフ(スタッフ選択・まとめて取り込む なし)',
    login: 'staff',
    fullPage: true,
    run: openTab,
  },
  {
    name: 'att-day-editable',
    title: '出勤簿: 1日表示(今日・直せる日・移動と距離)',
    fullPage: true,
    run: (page) => openDay(page, '金', 25),
  },
  {
    name: 'att-day-menu',
    title: '出勤簿: ✏️ 記録を直す・足す のメニュー',
    run: async (page) => {
      await openDay(page, '金', 25);
      await button(page, '✏️ 記録を直す・足す').click();
      await wait(page, 300);
    },
  },
  {
    name: 'att-day-one-visit',
    title: '出勤簿: 1日表示(訪問1件の水曜・移動と距離の区間が少ない)',
    fullPage: true,
    run: (page) => openDay(page, '水', 23),
  },
  {
    name: 'att-day-no-visit',
    title: '出勤簿: 1日表示(記録の無い日・この日は訪問さきの記録がありません)',
    fullPage: true,
    run: (page) => openDay(page, '土', 26),
  },
  {
    name: 'att-day-readonly',
    title: '出勤簿: 1日表示(先月の日・見るだけ)',
    fullPage: true,
    run: async (page) => {
      await openTab(page);
      for (let i = 0; i < 3; i++) {
        await button(page, '◀ 前の週').click();
        await wait(page, 300);
      }
      await dateButton(page, '月', 31).click();
      await wait(page, 600);
    },
  },
  {
    name: 'att-detail-weather',
    title: '出勤簿: 天候のボタンを押したところ(❄️ 雪)',
    fullPage: true,
    run: async (page) => {
      await openDay(page, '金', 25);
      await button(page, '❄️ 雪').click();
      await wait(page, 200);
    },
  },
  {
    name: 'att-detail-invalid',
    title: '出勤簿: 買い物代行の回数が数でないとき',
    run: async (page) => {
      await openDay(page, '月', 21);
      await page.locator('#pastScheduleDetailPanel input[type="number"][step="1"]').fill('1.5');
      await button(page, '保存する').click();
      await wait(page, 300);
    },
  },
  {
    name: 'att-slot-filled',
    title: '出勤簿: 予定の修正(入っている予定・削除あり)',
    run: async (page) => {
      await openDay(page, '金', 25);
      await openMenuItem(page, '1件目の訪問');
    },
  },
  {
    name: 'att-slot-empty',
    title: '出勤簿: 予定の修正(まだ無い予定・削除なし)',
    run: async (page) => {
      await openDay(page, '金', 25);
      await openMenuItem(page, '事務作業（2つ目）');
    },
  },
  {
    name: 'att-slot-office',
    title: '出勤簿: 予定の修正(事務作業・したこと)',
    run: async (page) => {
      await openDay(page, '金', 25);
      await openMenuItem(page, '事務作業（1つ目）');
    },
  },
  {
    name: 'att-slot-pending',
    title: '出勤簿: 週の表の予定を押した直後(準備しています…)',
    run: async (page) => {
      await openTab(page);
      await button(page, '📋 表で見る').click();
      await wait(page);
      await page.locator('#calDayGrid [title^="09:30〜11:30"]').first().click();
      await wait(page, 400);
    },
    gas: { mock: { delays: { getPastScheduleForDate: 'never' } } },
    web: { mock: { 'GET /api/attendance/day': { delayMs: 'never' } } },
  },
  {
    name: 'att-slot-from-grid',
    title: '出勤簿: 週の表の予定を押したところ(その予定の修正)',
    run: async (page) => {
      await openTab(page);
      await button(page, '📋 表で見る').click();
      await wait(page);
      await page.locator('#calDayGrid [title^="09:30〜11:30"]').first().click();
      await wait(page, 800);
    },
  },
  {
    name: 'att-slot-readonly',
    title: '出勤簿: 予定の修正(先月の日・見るだけ)',
    run: async (page) => {
      await openTab(page);
      for (let i = 0; i < 3; i++) {
        await button(page, '◀ 前の週').click();
        await wait(page, 300);
      }
      await dateButton(page, '月', 31).click();
      await wait(page, 600);
      await page.locator('#calDayGrid').getByText('田中 さくら').first().click();
      await wait(page, 600);
    },
  },
  {
    name: 'att-slot-saved',
    title: '出勤簿: 予定を保存したところ(お知らせ)',
    run: async (page) => {
      await openDay(page, '金', 25);
      await openMenuItem(page, '1件目の訪問');
      await page
        .locator('#pastScheduleSlotModal, [aria-labelledby="pastScheduleSlotModalTitle"]')
        .getByRole('button', { name: '保存する' })
        .click();
      await wait(page, 800);
    },
  },
  {
    name: 'att-diff-modal',
    title: '出勤簿: 🔄 最新にする → カレンダーと違うところ',
    run: async (page) => {
      await openDay(page, '金', 25);
      await button(page, '🔄 最新にする').click();
      await wait(page, 1000);
    },
  },
  {
    name: 'att-diff-applied',
    title: '出勤簿: カレンダーと違うところ → 取り込む(お知らせ)',
    run: async (page) => {
      await openDay(page, '金', 25);
      await button(page, '🔄 最新にする').click();
      await wait(page, 1000);
      await page
        .locator('[role="dialog"], #calendarSyncDiffModal')
        .getByRole('button', { name: '取り込む' })
        .filter(visible)
        .click();
      await wait(page, 1000);
    },
  },
  {
    name: 'att-refresh-same',
    title: '出勤簿: 🔄 最新にする → カレンダーと同じ(お知らせ)',
    run: async (page) => {
      await openDay(page, '木', 24);
      await button(page, '🔄 最新にする').click();
      await wait(page, 1000);
    },
  },
  {
    name: 'att-refresh-readonly',
    title: '出勤簿: 先月の日で 🔄 最新にする(読み直すだけ)',
    run: async (page) => {
      await openTab(page);
      for (let i = 0; i < 3; i++) {
        await button(page, '◀ 前の週').click();
        await wait(page, 300);
      }
      await dateButton(page, '月', 31).click();
      await wait(page, 600);
      await button(page, '🔄 最新にする').click();
      await wait(page, 1000);
    },
  },
  {
    name: 'att-range-sync',
    title: '出勤簿: まとめて取り込む(管理者)',
    run: openRangeSync,
  },
  {
    name: 'att-range-sync-running',
    title: '出勤簿: まとめて取り込む(取り込み中)',
    run: async (page) => {
      await openRangeSync(page);
      await button(page, /^取り込む$/).click();
      await wait(page, 500);
    },
    gas: { mock: { delays: { syncPastScheduleFromCalendar: 'never' } } },
    web: { mock: { 'POST /api/attendance/day/calendar-sync': { delayMs: 'never' } } },
  },
  {
    name: 'att-range-sync-failed',
    title: '出勤簿: まとめて取り込む(できなかった分がある)',
    run: async (page) => {
      await openRangeSync(page);
      await checkOnlyFirstStaff(page);
      await button(page, /^取り込む$/).click();
      await wait(page, 1200);
    },
    gas: { mock: { failures: { syncPastScheduleFromCalendar: 'カレンダーを読めませんでした' } } },
    web: {
      mock: {
        // GAS版の withFailureHandler(通信の失敗)に合わせ、理由の無い失敗にする
        'POST /api/attendance/day/calendar-sync': { status: 500, body: {} },
      },
    },
  },
  {
    name: 'att-monthly',
    title: '出勤簿: 今月のまとめ',
    run: openMonthly,
  },
  {
    name: 'att-monthly-bottom',
    title: '出勤簿: 今月のまとめ(下のほう・領収書)',
    run: async (page) => {
      await openMonthly(page);
      await page.getByText('領収書', { exact: true }).filter(visible).last().scrollIntoViewIfNeeded();
      await wait(page, 300);
    },
  },
  {
    name: 'att-monthly-empty',
    title: '出勤簿: 今月のまとめ(記録の無い月・📭)',
    run: async (page) => {
      await openMonthly(page);
      await page.locator('#attendanceMonthlyMonth').fill('2026-12');
      await button(page, /^見る$/).click();
      await wait(page, 800);
    },
  },
  {
    name: 'att-monthly-loading',
    title: '出勤簿: 今月のまとめ(読み込み中)',
    run: openMonthly,
    gas: { mock: { delays: { getAttendanceMonth: 'never' } } },
    web: { mock: { 'GET /api/attendance/month': { delayMs: 'never' } } },
  },
  {
    name: 'att-monthly-tap',
    title: '出勤簿: 今月のまとめの日を押したところ(その日の最初の予定)',
    run: async (page) => {
      await openMonthly(page);
      await page
        .getByRole('button', { name: /^1\s*火/ })
        .filter(visible)
        .first()
        .click();
      await wait(page, 800);
    },
  },
];
