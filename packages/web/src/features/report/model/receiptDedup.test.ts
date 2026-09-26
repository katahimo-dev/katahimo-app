import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../lib/memoryStorage.test-helper';
import {
  buildReceiptDupKey,
  findLocalReceiptDuplicates,
  forgetSentReceipt,
  formatReceiptDuplicateWarning,
  loadReceiptKeyMap,
  normalizeReceiptAmount,
  pruneReceiptKeyMap,
  RECEIPT_LOCAL_RETENTION_MS,
  receiptBucketKey,
  recordSentReceipts,
  saveReceiptKeyMap,
} from './receiptDedup';

const NOW = Date.parse('2026-09-25T10:00:00+09:00');
const DAY = 24 * 60 * 60 * 1000;

describe('印の作り方(GAS版 buildReceiptLocalDupKey)', () => {
  it('日時||お客様ID||金額||お店の名前(前後の空白・カンマを除く)', () => {
    expect(buildReceiptDupKey(' 2026/09/25 11:02 ', 'c1', '1,280', ' スーパー ')).toBe(
      '2026/09/25 11:02||c1||1280||スーパー',
    );
  });
  it('金額は数値にそろえる。数値でなければ文字のまま', () => {
    expect(normalizeReceiptAmount(1280)).toBe('1280');
    expect(normalizeReceiptAmount('01280')).toBe('1280');
    expect(normalizeReceiptAmount(' 千円 ')).toBe('千円');
    expect(normalizeReceiptAmount('')).toBe('');
    expect(normalizeReceiptAmount(null)).toBe('');
  });
  it('スタッフごとのキーは GAS_RECEIPT_KEYS_V1_<名前>', () => {
    expect(receiptBucketKey('佐藤 美咲')).toBe('GAS_RECEIPT_KEYS_V1_佐藤 美咲');
    expect(receiptBucketKey('')).toBe('GAS_RECEIPT_KEYS_V1_unknown');
  });
});

describe('45日より古い印を捨てる(GAS版 pruneReceiptLocalKeyMap)', () => {
  it('ちょうど45日前は残し、それより古いものと壊れた値は捨てる', () => {
    const map = {
      keep: NOW - RECEIPT_LOCAL_RETENTION_MS,
      old: NOW - RECEIPT_LOCAL_RETENTION_MS - 1,
      fresh: NOW - DAY,
      broken: 'x',
    };
    expect(pruneReceiptKeyMap(map, NOW)).toEqual({
      keep: NOW - RECEIPT_LOCAL_RETENTION_MS,
      fresh: NOW - DAY,
    });
  });
  it('古い形(true / { savedAt })も読む', () => {
    expect(pruneReceiptKeyMap({ a: true, b: { savedAt: NOW - DAY }, c: { savedAt: 'x' } }, NOW)).toEqual({
      a: NOW,
      b: NOW - DAY,
    });
  });
  it('読むときに古い印があれば保存し直す', () => {
    const key = receiptBucketKey('佐藤 美咲');
    const storage = createMemoryStorage({
      [key]: JSON.stringify({ fresh: NOW - DAY, old: NOW - 50 * DAY }),
    });
    expect(loadReceiptKeyMap('佐藤 美咲', NOW, storage)).toEqual({ fresh: NOW - DAY });
    expect(JSON.parse(storage.snapshot()[key] ?? '{}')).toEqual({ fresh: NOW - DAY });
  });
  it('壊れた保存値は空として扱う', () => {
    const storage = createMemoryStorage({ [receiptBucketKey('a')]: '{broken' });
    expect(loadReceiptKeyMap('a', NOW, storage)).toEqual({});
  });
});

describe('前に送った領収書を探す(GAS版 uploadReceiptsOnly の送る前の確認)', () => {
  const fallbackTimestamp = '2026/09/25 09:00:00';
  const receipts = [
    { amount: '1280', storeName: 'スーパーみどり', receiptDate: '2026/09/25 11:02' },
    { amount: '', storeName: 'コンビニ', receiptDate: '' },
    { amount: 540, storeName: '薬局', receiptDate: '' },
  ];

  it('送ったあとに同じものを送ろうとすると見つかる(日時が無いものはまとめての日時で比べる)', () => {
    const storage = createMemoryStorage();
    const sent = recordSentReceipts({}, receipts, { customerId: 'c1', fallbackTimestamp, now: NOW });
    saveReceiptKeyMap('staff', sent, NOW, storage);
    expect(Object.keys(sent)).toEqual([
      '2026/09/25 11:02||c1||1280||スーパーみどり',
      '2026/09/25 09:00:00||c1||540||薬局',
    ]);
    const dups = findLocalReceiptDuplicates(receipts, {
      customerId: 'c1',
      customerName: '田中 さくら',
      fallbackTimestamp,
      sent: loadReceiptKeyMap('staff', NOW, storage),
    });
    expect(dups).toEqual([
      {
        index: 0,
        timestamp: '2026/09/25 11:02',
        customerName: '田中 さくら',
        amount: '1280',
        storeName: 'スーパーみどり',
      },
      {
        index: 2,
        timestamp: fallbackTimestamp,
        customerName: '田中 さくら',
        amount: '540',
        storeName: '薬局',
      },
    ]);
  });

  it('取消した領収書の印を消す(分まで・秒までのどちらの日時で送った印も)', () => {
    const sent = recordSentReceipts({}, receipts, { customerId: 'c1', fallbackTimestamp, now: NOW });
    const afterFirst = forgetSentReceipt(sent, {
      receiptedAt: '2026/09/25 11:02:00',
      customerId: 'c1',
      amountYen: 1280,
      storeName: 'スーパーみどり',
    });
    expect(Object.keys(afterFirst)).toEqual(['2026/09/25 09:00:00||c1||540||薬局']);
    const afterBoth = forgetSentReceipt(afterFirst, {
      receiptedAt: '2026/09/25 09:00:00',
      customerId: 'c1',
      amountYen: 540,
      storeName: '薬局',
    });
    expect(afterBoth).toEqual({});
    // 別のお客様の同じ内容は消さない
    expect(
      forgetSentReceipt(sent, {
        receiptedAt: '2026/09/25 11:02:00',
        customerId: null,
        amountYen: 1280,
        storeName: 'スーパーみどり',
      }),
    ).toEqual(sent);
  });

  it('お客様が違えば別の領収書', () => {
    const sent = recordSentReceipts({}, receipts, { customerId: 'c1', fallbackTimestamp, now: NOW });
    expect(
      findLocalReceiptDuplicates(receipts, { customerId: '', customerName: '', fallbackTimestamp, sent }),
    ).toEqual([]);
  });

  it('知らせの文はGAS版と同じ', () => {
    expect(
      formatReceiptDuplicateWarning(
        [
          { timestamp: '2026/09/25 11:02', amount: '1280', storeName: 'スーパーみどり' },
          { timestamp: '2026/09/25 09:00:00', customerName: '山田', amount: '540', storeName: '薬局' },
        ],
        '田中 さくら',
      ),
    ).toBe(
      '⚠️ この領収書はすでに登録ずみのため、登録していません\n' +
        '1. 2026/09/25 11:02 / お客様の名前:田中 さくら / 金額:1280 / お店の名前:スーパーみどり\n' +
        '2. 2026/09/25 09:00:00 / お客様の名前:山田 / 金額:540 / お店の名前:薬局',
    );
  });
});
