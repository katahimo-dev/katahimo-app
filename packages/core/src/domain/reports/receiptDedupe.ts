import { createHash } from 'node:crypto';

/**
 * 領収書の重複判定キー組み立て。GAS版Main.js processReceiptImagesの
 * normalizeAmount/normalizeText/buildKeyと完全に同一のロジック
 * (登録時と照合時で同じキーになるよう、必ずこの関数を通した文字列を使うこと)。
 */
export function normalizeAmount(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '';
  const n = Number(String(val).replace(/,/g, '').trim());
  if (Number.isNaN(n)) return String(val).trim();
  return String(n);
}

export function normalizeText(val: string | null | undefined): string {
  return val === null || val === undefined ? '' : String(val).trim();
}

export interface ReceiptDedupeKeyInput {
  /** 領収書日時。GAS版はスプレッドシートの日時セルの文字列表現。 */
  timestamp: string;
  staffId: string;
  customerId: string;
  amount: string | number | null | undefined;
  storeName: string | null | undefined;
}

/** 金額・店舗名の両方が入力されている場合だけ重複判定の対象にする(GAS版canCheckDuplicateと同じ)。 */
export function canCheckReceiptDuplicate(
  input: Pick<ReceiptDedupeKeyInput, 'amount' | 'storeName'>,
): boolean {
  return normalizeAmount(input.amount) !== '' && normalizeText(input.storeName) !== '';
}

export function buildReceiptDedupeKey(input: ReceiptDedupeKeyInput): string {
  return [
    normalizeText(input.timestamp),
    normalizeText(input.staffId),
    normalizeText(input.customerId),
    normalizeAmount(input.amount),
    normalizeText(input.storeName),
  ].join('||');
}

/**
 * receipts.dedupe_hash に入れる値(キーの SHA-256)。キーは店名を含み長さに上限が無いため、UNIQUE 索引には
 * 固定長のハッシュを載せる。
 */
export function receiptDedupeHash(key: string): Uint8Array {
  return createHash('sha256').update(key, 'utf8').digest();
}
