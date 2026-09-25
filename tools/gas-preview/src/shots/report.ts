import { crc32, deflateSync } from 'node:zlib';
import type { Page } from 'playwright-core';
import { CUSTOMERS } from '../fixtures';
import { type Shot, type Target, userStorageKey, visible } from './types';

/**
 * 日報・事故報告・領収書のダイアログ(GAS版 #reportModal)の場面。
 *
 * ダイアログは、GAS版は openModal(allCustomers[0]) / openStandaloneReceiptModal()、新アプリは開発サーバーだけで
 * 使える window.__katahimoReport(ReportModalProvider)で開く(お客様タブ・予定タブは別の担当が作るため、
 * それを通らずに開く)。背景のタブの中身は比べない(暗い背景ごしに見える部分)。
 */
const TANAKA = CUSTOMERS[0] as (typeof CUSTOMERS)[number];

const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name }).filter(visible).first();

async function openReport(page: Page, target: Target) {
  if (target === 'gas') {
    // GAS版の allCustomers は let で宣言された大域の変数(window のプロパティではない)ので、式の文字列で扱う
    await page.waitForFunction('typeof allCustomers !== "undefined" && allCustomers.length > 0');
    await page.evaluate('openModal(allCustomers[0])');
  } else {
    await page.waitForFunction(
      () => (globalThis as unknown as { __katahimoReport?: unknown }).__katahimoReport,
    );
    await page.evaluate(
      ({ customerId, customerName }) => {
        const w = globalThis as unknown as {
          __katahimoReport: { openReport: (t: { customerId: string; customerName: string }) => void };
        };
        w.__katahimoReport.openReport({ customerId, customerName });
      },
      { customerId: TANAKA.uuid, customerName: TANAKA.name },
    );
  }
  await page.waitForTimeout(500);
}

async function openStandalone(page: Page, target: Target) {
  if (target === 'gas') {
    await page.evaluate(() =>
      (globalThis as unknown as { openStandaloneReceiptModal: () => void }).openStandaloneReceiptModal(),
    );
  } else {
    await page.waitForFunction(
      () => (globalThis as unknown as { __katahimoReport?: unknown }).__katahimoReport,
    );
    await page.evaluate(() =>
      (
        globalThis as unknown as { __katahimoReport: { openStandaloneReceipt: () => void } }
      ).__katahimoReport.openStandaloneReceipt(),
    );
  }
  await page.waitForTimeout(500);
}

/** ダイアログの本文を、指定した部分が上に来るまでスクロールする(どちらも同じ id を持つ) */
async function scrollBodyTo(page: Page, selector: string, block: 'start' | 'end' = 'start') {
  await page.evaluate(({ selector, block }) => document.querySelector(selector)?.scrollIntoView({ block }), {
    selector,
    block,
  });
  await page.waitForTimeout(200);
}

const MEMO = '公園で外遊び。お昼ごはんの手伝い。お母さんは少し疲れていた様子。';

async function fillMemo(page: Page, text = MEMO) {
  await page.locator('#reportInput').fill(text);
}

async function generate(page: Page) {
  await page.locator('#generateBtn').click();
  // 結果欄へのなめらかなスクロールが終わるまで待つ
  await page.waitForTimeout(1200);
}

async function switchToAccident(page: Page) {
  // 新アプリは「タブ」(role=tab)なので、どちらにもある id で押す
  await page.locator('#tabAccident').filter(visible).click();
  await page.waitForTimeout(200);
}

// ── 領収書の写真(テスト用の縦長PNGを作る) ──

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** 白地に灰色の横線(レシートらしい見た目)の PNG */
function receiptPng(width: number, height: number, tint: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    const line = y % 40 < 6 && y > 60;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      const v = line && x > 30 && x < width - 30 ? 120 : 250;
      raw[i] = v;
      raw[i + 1] = v - (y < 60 ? tint : 0);
      raw[i + 2] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const receiptFile = (n: number) => ({
  name: `receipt${n}.png`,
  mimeType: 'image/png',
  buffer: receiptPng(300, 600, 40 * n),
});

async function addReceipts(page: Page, count: number) {
  await page
    .locator('#galleryInput')
    .setInputFiles(Array.from({ length: count }, (_, i) => receiptFile(i + 1)));
  await page.waitForTimeout(800);
}

/** 保存していない日報(GAS版と同じ形。お客様IDだけ GAS版と新アプリで違う) */
function pendingDraft(target: Target) {
  return JSON.stringify({
    customerId: target === 'gas' ? TANAKA.id : TANAKA.uuid,
    customerName: TANAKA.name,
    mode: 'daily',
    inputText: MEMO,
    start: '09:30',
    end: '11:30',
    savedAt: Date.parse('2026-09-24T12:00:00+09:00'),
    internalResult: '【サポート内容】\n公園で外遊び、昼食の補助。',
    customerResult: '本日もありがとうございました。\n\n管理者',
  });
}

/** 読み込み直したあとも残るよう、クリア(ハーネスの初期化)のあとに入れる */
async function setStorageAndReload(page: Page, entries: Record<string, string>) {
  await page.addInitScript((e) => {
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, entries);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(800);
}

/** 音声入力を、何もしない偽物にする(聞いているあいだの見た目を撮るため) */
async function fakeSpeechRecognitionAndReload(page: Page) {
  // tsx(esbuild)は class に __name を差し込むため、ブラウザで動かす処理は文字列で渡す
  await page.addInitScript(`(() => {
    class FakeRecognition { start() {} stop() {} abort() {} }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
  })()`);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** 背景のタブの中身(別の担当が作る部分)は比べない */
const MAIN = ['main > *'];
const MODAL = { gas: { hide: MAIN }, web: { hide: MAIN } } as const;

const withMock = (gas: Shot['gas'], web: Shot['web']) => ({
  gas: { hide: MAIN, ...gas },
  web: { hide: MAIN, ...web },
});

export const reportShots: Shot[] = [
  {
    name: 'report-daily-empty',
    title: '日報: 開いたところ(今日の日報)',
    ...MODAL,
    run: openReport,
  },
  {
    name: 'report-daily-datetime-editor',
    title: '日報: 「変える」で日付・時刻を開いたところ',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await button(page, '変える').click();
      await page.locator('#startHour').selectOption('13');
      await page.locator('#startMinute').selectOption('30');
      await button(page, '◀ 前の日').click();
    },
  },
  {
    name: 'report-daily-empty-memo-toast',
    title: '日報: メモが空のまま「AIに書いてもらう」',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await page.locator('#generateBtn').click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'report-daily-loading',
    title: '日報: AIが書いているあいだ',
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await page.locator('#generateBtn').click();
      await page.waitForTimeout(300);
    },
    ...withMock(
      { mock: { delays: { generateReportWithWarnings: 'never' } } },
      { mock: { 'POST /api/reports/daily/generate': { delayMs: 'never' } } },
    ),
  },
  {
    name: 'report-daily-result',
    title: '日報: AIが書いた結果',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
    },
  },
  {
    name: 'report-daily-result-bottom',
    title: '日報: 結果の下(星・領収書・訪問終わりました)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
      await page.locator('#star-risk button').nth(1).click();
      await page.locator('#star-es button').nth(3).click();
      await scrollBodyTo(page, '#assessmentSection');
    },
  },
  {
    name: 'report-daily-copy',
    title: '日報: 「📋 コピーしてLINEに貼る」',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
      await scrollBodyTo(page, '#customerResult', 'end');
      await button(page, '📋 コピーしてLINEに貼る').click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'report-daily-warnings',
    title: '日報: 足りない情報があるとき',
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
    },
    ...withMock(
      {
        mock: {
          overrides: {
            generateReportWithWarnings: {
              warnings: ['終わった時間', 'お子様の様子'],
              internal: '【サポート内容】\n公園で外遊び。',
              customer: '本日もありがとうございました。',
            },
          },
        },
      },
      {
        mock: {
          'POST /api/reports/daily/generate': {
            body: {
              draft: {
                warnings: ['終わった時間', 'お子様の様子'],
                internal: '【サポート内容】\n公園で外遊び。',
                customer: '本日もありがとうございました。',
              },
            },
          },
        },
      },
    ),
  },
  {
    name: 'report-daily-api-error',
    title: '日報: AIが使えないとき(APIキー未設定)',
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
    },
    ...withMock(
      {
        mock: {
          overrides: {
            generateReportWithWarnings: {
              warnings: ['API Key Missing'],
              internal: 'Error: API Key not set',
              customer: '',
            },
          },
        },
      },
      {
        mock: {
          'POST /api/reports/daily/generate': {
            body: {
              draft: { warnings: ['API Key Missing'], internal: 'Error: API Key not set', customer: '' },
            },
          },
        },
      },
    ),
  },
  {
    name: 'report-daily-saving',
    title: '日報: 保存しているあいだ',
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
      await page.locator('#saveBtn').click();
      await page.waitForTimeout(300);
    },
    ...withMock(
      { mock: { delays: { saveReport: 'never' } } },
      { mock: { 'POST /api/reports/daily': { delayMs: 'never' } } },
    ),
  },
  {
    name: 'report-daily-saved',
    title: '日報: 保存したあと(✅ 保存しました)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
      await page.locator('#saveBtn').click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'report-overwrite-confirm',
    title: '日報: 保存したあとにもう一度保存(書きかえの確認)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await fillMemo(page);
      await generate(page);
      await page.locator('#saveBtn').click();
      await page.waitForTimeout(600);
      await page.locator('#internalResult').fill('【サポート内容】\n公園で外遊び、昼食の補助。(直した)');
      await page.locator('#saveBtn').click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'report-assessment-hint',
    title: '日報: 星の質問の「❓ 説明」',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await scrollBodyTo(page, '#assessmentSection');
      await button(page, '❓ 説明').click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'report-assessment-hint-es',
    title: '日報: 働きやすさ(ES)の「❓ 説明」',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await scrollBodyTo(page, '#assessmentSection');
      await page.getByRole('button', { name: '❓ 説明' }).filter(visible).nth(1).click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'report-voice-listening',
    title: '日報: 「🎤 話して入力」で聞いているあいだ',
    ...MODAL,
    run: async (page, target) => {
      await fakeSpeechRecognitionAndReload(page);
      await openReport(page, target);
      await button(page, /話して入力/).click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'report-accident-empty',
    title: '事故: 開いたところ(1人目のお子様を選んである)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await switchToAccident(page);
    },
  },
  {
    name: 'report-accident-hiyari',
    title: '事故: ヒヤリハットを選んで時間を開いたところ',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await switchToAccident(page);
      await page.getByText('ヒヤリハット', { exact: true }).filter(visible).click();
      await page.locator('#familySelector').selectOption('1');
      await button(page, '変える').click();
    },
  },
  {
    name: 'report-accident-hint',
    title: '事故: 「💡 書き方のヒント」(事故報告)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await switchToAccident(page);
      await button(page, '💡 書き方のヒント').click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'report-accident-hint-hiyari',
    title: '事故: 「💡 書き方のヒント」(ヒヤリハット)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await switchToAccident(page);
      await page.getByText('ヒヤリハット', { exact: true }).filter(visible).click();
      await button(page, '💡 書き方のヒント').click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'report-accident-draft',
    title: '事故: AIが作った報告書の下書き',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await switchToAccident(page);
      await fillMemo(page, 'ソファから降りるときにつまずきそうになったが支えた');
      await generate(page);
    },
  },
  {
    name: 'report-accident-draft-bottom',
    title: '事故: 下書きの下のほう(対策・訪問終わりました)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await switchToAccident(page);
      await fillMemo(page, 'ソファから降りるときにつまずきそうになったが支えた');
      await generate(page);
      await scrollBodyTo(page, '#visitCompleteContainer', 'end');
    },
  },
  {
    name: 'report-accident-saved',
    title: '事故: 保存したあと(お知らせ)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await switchToAccident(page);
      await fillMemo(page, 'ソファから降りるときにつまずきそうになったが支えた');
      await generate(page);
      await page.locator('#saveBtn').click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'report-receipts-ocr',
    title: '領収書: 写真を足して金額を読み取っているあいだ',
    run: async (page, target) => {
      await openReport(page, target);
      await addReceipts(page, 2);
      await scrollBodyTo(page, '#imageUploadSection');
    },
    ...withMock(
      { mock: { delays: { extractAmountFromImage: 'never' } } },
      { mock: { 'POST /api/receipts/ocr': { delayMs: 'never' } } },
    ),
  },
  {
    name: 'report-receipts-images',
    title: '領収書: 読み取ったあと(日付・金額・お店の名前)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await addReceipts(page, 2);
      await page.locator('#receiptHandoff').fill('駐車場代です');
      await scrollBodyTo(page, '#imageUploadSection');
    },
  },
  {
    name: 'report-receipts-six',
    title: '領収書: 6枚足したとき(「撮る」「選ぶ」が消える)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await addReceipts(page, 6);
      await scrollBodyTo(page, '#imageUploadSection');
    },
  },
  {
    name: 'report-receipts-over-limit',
    title: '領収書: 6枚を越えて足そうとしたとき',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await addReceipts(page, 5);
      await addReceipts(page, 2);
      await scrollBodyTo(page, '#imageUploadSection');
    },
  },
  {
    name: 'report-receipts-sent',
    title: '領収書: 送ったあと(お知らせ)',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await addReceipts(page, 1);
      await button(page, 'この領収書を送る').click();
      await page.waitForTimeout(600);
      await scrollBodyTo(page, '#imageUploadSection');
    },
  },
  {
    name: 'report-receipts-local-duplicate',
    title: '領収書: この端末から前に送ったものをもう一度送ろうとしたとき',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await addReceipts(page, 1);
      await button(page, 'この領収書を送る').click();
      await page.waitForTimeout(600);
      await addReceipts(page, 1);
      await button(page, 'この領収書を送る').click();
      await page.waitForTimeout(400);
      await scrollBodyTo(page, '#imageUploadSection');
    },
  },
  {
    name: 'report-receipts-server-duplicate',
    title: '領収書: サーバーで登録ずみと分かったとき',
    run: async (page, target) => {
      await openReport(page, target);
      await addReceipts(page, 2);
      await button(page, 'この領収書を送る').click();
      await page.waitForTimeout(600);
      await scrollBodyTo(page, '#imageUploadSection');
    },
    ...withMock(
      {
        mock: {
          overrides: {
            uploadReceiptsOnly: {
              success: true,
              message: '1件の領収書を送りました(1件は登録ずみでした)',
              duplicates: [
                { index: 1, timestamp: '2026/09/25 11:02', amount: '1280', storeName: 'スーパーみどり' },
              ],
            },
          },
        },
      },
      {
        mock: {
          'POST /api/receipts': {
            body: {
              success: true,
              message: '1件の領収書を送りました(1件は登録ずみでした)',
              uploadedCount: 1,
              duplicateCount: 1,
              duplicates: [
                { index: 1, timestamp: '2026/09/25 11:02', amount: '1280', storeName: 'スーパーみどり' },
              ],
              uploadBatchId: '00000000-0000-4000-8000-0000000000d1',
            },
          },
        },
      },
    ),
  },
  {
    name: 'report-standalone-receipt',
    title: 'お客様の指定なしの領収書',
    ...MODAL,
    run: async (page, target) => {
      await openStandalone(page, target);
      await page.locator('#unregisteredCustomerName').fill('山田 花子');
      await addReceipts(page, 1);
    },
  },
  {
    name: 'report-visit-complete-sent',
    title: '「✅ 訪問終わりました」を送ったあと',
    ...MODAL,
    run: async (page, target) => {
      await openReport(page, target);
      await button(page, '✅ 訪問終わりました（事務局に知らせる）').click();
      await page.waitForTimeout(600);
      await scrollBodyTo(page, '#visitCompleteContainer', 'end');
    },
  },
  {
    name: 'report-draft-restore',
    title: '保存していない日報が残っていたとき(開き直すと自動で開いて戻す)',
    ...MODAL,
    run: async (page, target) => {
      await setStorageAndReload(page, {
        [userStorageKey(target, 'pending_report_draft')]: pendingDraft(target),
      });
      await page.waitForTimeout(600);
    },
  },
];
