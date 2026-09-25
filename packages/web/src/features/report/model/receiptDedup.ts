import { type KeyValueStorage, readStorage, STORAGE_KEYS, writeStorage } from '../../../lib/storage';

/**
 * 同じ領収書を二度送らないための、端末に残す「送った領収書の印」(GAS版 L5627–5740)。
 *
 * - 印 = 日時 || お客様ID || 金額 || お店の名前(金額とお店の名前がどちらもあるものだけ)。
 * - スタッフごとに `GAS_RECEIPT_KEYS_V1_<スタッフ名>` に `{ 印: 送った時刻(ms) }` で保存し、45日より古い印は捨てる。
 * - 値の形・キー名はGAS版と同じ(GAS版で送った印もそのまま読める)。
 */
export const RECEIPT_LOCAL_RETENTION_DAYS = 45;
export const RECEIPT_LOCAL_RETENTION_MS = RECEIPT_LOCAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type ReceiptKeyMap = Record<string, number>;

/** 金額を比べられる形にする(カンマを除いた数値の文字列。数値でなければ前後の空白を除いた文字列) */
export function normalizeReceiptAmount(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(String(value).replace(/,/g, '').trim());
  if (Number.isNaN(n)) return String(value).trim();
  return String(n);
}

export function normalizeReceiptText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function buildReceiptDupKey(
  timestamp: string,
  customerId: string,
  amount: unknown,
  storeName: unknown,
): string {
  return [
    normalizeReceiptText(timestamp),
    normalizeReceiptText(customerId),
    normalizeReceiptAmount(amount),
    normalizeReceiptText(storeName),
  ].join('||');
}

export function receiptBucketKey(staffName: string): string {
  return `${STORAGE_KEYS.receiptLocalKeyPrefix}${normalizeReceiptText(staffName || 'unknown')}`;
}

/** 古い形(true や { savedAt })で保存された値も送った時刻として読む */
function savedAtOf(value: unknown, now: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const savedAt = (value as { savedAt?: unknown }).savedAt;
    if (typeof savedAt === 'number' && Number.isFinite(savedAt)) return savedAt;
  }
  if (value === true) return now;
  return 0;
}

/** 45日より古い印を捨てる */
export function pruneReceiptKeyMap(
  map: Record<string, unknown> | null | undefined,
  now: number,
): ReceiptKeyMap {
  const cutoff = now - RECEIPT_LOCAL_RETENTION_MS;
  const pruned: ReceiptKeyMap = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    const savedAt = savedAtOf(value, now);
    if (savedAt >= cutoff) pruned[key] = savedAt;
  }
  return pruned;
}

export function saveReceiptKeyMap(
  staffName: string,
  map: ReceiptKeyMap,
  now: number,
  storage?: KeyValueStorage | null,
) {
  writeStorage(receiptBucketKey(staffName), JSON.stringify(pruneReceiptKeyMap(map, now)), storage);
}

/** 保存してある印を読む(古い印を捨てたら保存し直す) */
export function loadReceiptKeyMap(
  staffName: string,
  now: number,
  storage?: KeyValueStorage | null,
): ReceiptKeyMap {
  const raw = readStorage(receiptBucketKey(staffName), storage);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const record = parsed as Record<string, unknown>;
  const pruned = pruneReceiptKeyMap(record, now);
  if (Object.keys(record).length !== Object.keys(pruned).length) {
    saveReceiptKeyMap(staffName, pruned, now, storage);
  }
  return pruned;
}

export interface ReceiptForDedup {
  amount: unknown;
  storeName: unknown;
  /** 'yyyy/MM/dd HH:mm'(画像ごとの日時。空ならまとめての日時を使う) */
  receiptDate: string;
}

export interface ReceiptDuplicate {
  index: number;
  timestamp: string;
  customerName: string;
  amount: string;
  storeName: string;
}

/** 金額とお店の名前がどちらもあれば印を作る(どちらかが無いものは重複を確かめない) */
export function receiptDupKeyOf(
  receipt: ReceiptForDedup,
  customerId: string,
  fallbackTimestamp: string,
): { key: string; timestamp: string; amount: string; storeName: string } | null {
  const amount = normalizeReceiptAmount(receipt.amount ?? '');
  const storeName = normalizeReceiptText(receipt.storeName ?? '');
  if (amount === '' || storeName === '') return null;
  const timestamp = receipt.receiptDate || fallbackTimestamp;
  return { key: buildReceiptDupKey(timestamp, customerId, amount, storeName), timestamp, amount, storeName };
}

/** 送る前に、この端末から前に送ったものと同じ領収書を探す */
export function findLocalReceiptDuplicates(
  receipts: readonly ReceiptForDedup[],
  opts: { customerId: string; customerName: string; fallbackTimestamp: string; sent: ReceiptKeyMap },
): ReceiptDuplicate[] {
  const duplicates: ReceiptDuplicate[] = [];
  receipts.forEach((receipt, index) => {
    const dup = receiptDupKeyOf(receipt, opts.customerId, opts.fallbackTimestamp);
    if (!dup || !opts.sent[dup.key]) return;
    duplicates.push({
      index,
      timestamp: dup.timestamp,
      customerName: opts.customerName,
      amount: dup.amount,
      storeName: dup.storeName,
    });
  });
  return duplicates;
}

/** 送れた領収書の印を足す(新しいmapを返す) */
export function recordSentReceipts(
  map: ReceiptKeyMap,
  receipts: readonly ReceiptForDedup[],
  opts: { customerId: string; fallbackTimestamp: string; now: number },
): ReceiptKeyMap {
  const next = { ...map };
  for (const receipt of receipts) {
    const dup = receiptDupKeyOf(receipt, opts.customerId, opts.fallbackTimestamp);
    if (dup) next[dup.key] = opts.now;
  }
  return next;
}

/**
 * 「⚠️ この領収書はすでに登録ずみのため、登録していません」の文(GAS版 showReceiptDuplicateWarning)。
 * 1行目の見出しのあとに「1. 日時 / お客様の名前:… / 金額:… / お店の名前:…」を並べる。
 */
export function formatReceiptDuplicateWarning(
  duplicates: readonly {
    timestamp?: string;
    customerName?: string;
    amount?: string;
    storeName?: string;
  }[],
  fallbackCustomerName: string,
): string {
  const lines = duplicates.map(
    (d, idx) =>
      `${idx + 1}. ${d.timestamp || ''} / お客様の名前:${d.customerName || fallbackCustomerName || ''} / 金額:${d.amount || ''} / お店の名前:${d.storeName || ''}`,
  );
  return `⚠️ この領収書はすでに登録ずみのため、登録していません\n${lines.join('\n')}`;
}
