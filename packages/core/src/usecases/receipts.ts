import { randomUUID } from 'node:crypto';
import {
  buildReceiptDedupeKey,
  buildReceiptNotificationText,
  canCheckReceiptDuplicate,
  normalizeAmount,
  normalizeText,
  parseJstTimestampString,
} from '../domain';
import type { BlindIndexPort, CryptoPort } from '../ports/crypto';
import type { MirrorPort } from '../ports/mirror';
import type { NotifierPort } from '../ports/notifier';
import type {
  CustomerRepositoryPort,
  ReceiptRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { StoragePort } from '../ports/storage';

export interface ReceiptDeps {
  receipts: ReceiptRepositoryPort;
  staff: StaffRepositoryPort;
  customers: CustomerRepositoryPort;
  crypto: CryptoPort;
  blindIndex: BlindIndexPort;
  storage: StoragePort;
  notifier: NotifierPort;
  /** 領収書ログシート+Driveフォルダへのミラー書き込み要求をoutboxに積む(Phase 5)。 */
  mirror: MirrorPort;
}

export interface ReceiptImageInput {
  /** data URL('data:image/jpeg;base64,...')。GAS版processReceiptImagesの base64Data と同じ。 */
  data: string;
  amount?: string | number | null;
  storeName?: string | null;
  /** OCRで取得した領収書日時('yyyy/MM/dd HH:mm'等)。無ければfallbackTimestampを使う。 */
  receiptDate?: string | null;
}

export interface UploadReceiptsInput {
  staffId: string;
  customerId: string | null;
  images: ReceiptImageInput[];
  /** 'yyyy/MM/dd HH:mm:ss'。各画像にreceiptDateが無い場合のフォールバック時刻。 */
  fallbackTimestamp: string;
  handoffText?: string;
}

export interface ReceiptDuplicateInfo {
  index: number;
  timestamp: string;
  amount: string;
  storeName: string;
}

export interface UploadReceiptsResult {
  success: boolean;
  message: string;
  uploadedCount: number;
  duplicateCount: number;
  duplicates: ReceiptDuplicateInfo[];
}

function decodeDataUrl(dataUrl: string): { contentType: string; bytes: Uint8Array } | null {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(0, commaIndex);
  const base64Body = dataUrl.slice(commaIndex + 1);
  if (!base64Body) return null;
  const match = /^data:(.*?);base64$/.exec(header);
  const contentType = match?.[1] || 'image/jpeg';
  return { contentType, bytes: new Uint8Array(Buffer.from(base64Body, 'base64')) };
}

/**
 * 領収書画像をアップロードする。GAS版Main.jsのprocessReceiptImages/uploadReceiptsOnlyに対応。
 * 「スタッフ・顧客・日時・金額・店舗名」が全て一致するものはブラインドインデックスで重複検出し
 * 登録をブロックする(金額または店舗名が未入力の画像は判定対象外。GAS版canCheckDuplicateと同じ)。
 * 登録成功が1件以上あればGoogle Chatへ通知する。
 */
export async function uploadReceipts(
  deps: ReceiptDeps,
  tenantId: string,
  input: UploadReceiptsInput,
): Promise<UploadReceiptsResult> {
  if (!input.images || input.images.length === 0) {
    return {
      success: false,
      message: '領収書画像がありません。',
      uploadedCount: 0,
      duplicateCount: 0,
      duplicates: [],
    };
  }

  const perImage = await Promise.all(
    input.images.map(async (img, index) => {
      const timestamp = normalizeText(img.receiptDate) || input.fallbackTimestamp;
      const canCheck = canCheckReceiptDuplicate({ amount: img.amount, storeName: img.storeName });
      const dedupeBlindIndex = canCheck
        ? await deps.blindIndex.compute(
            tenantId,
            buildReceiptDedupeKey({
              timestamp,
              staffId: input.staffId,
              customerId: input.customerId ?? '',
              amount: img.amount,
              storeName: img.storeName,
            }),
          )
        : null;
      return { index, img, timestamp, dedupeBlindIndex };
    }),
  );

  const candidateIndexes = perImage.map((p) => p.dedupeBlindIndex).filter((v): v is string => v !== null);
  const existing =
    candidateIndexes.length > 0
      ? await deps.receipts.findExistingDedupeIndexes(tenantId, candidateIndexes)
      : new Set<string>();

  const duplicates: ReceiptDuplicateInfo[] = [];
  const registeredImages: { amount: string; storeName: string }[] = [];
  let uploadedCount = 0;

  for (const p of perImage) {
    if (p.dedupeBlindIndex && existing.has(p.dedupeBlindIndex)) {
      duplicates.push({
        index: p.index,
        timestamp: p.timestamp,
        amount: normalizeAmount(p.img.amount),
        storeName: normalizeText(p.img.storeName),
      });
      continue;
    }

    const decoded = decodeDataUrl(p.img.data);
    if (!decoded) continue;

    const fileKey = `${tenantId}/receipts/${randomUUID()}.jpg`;
    await deps.storage.put(fileKey, decoded.contentType, decoded.bytes);

    const [amountEnc, storeNameEnc, handoffEnc] = await Promise.all([
      p.img.amount !== undefined && p.img.amount !== null && p.img.amount !== ''
        ? deps.crypto.encrypt(tenantId, String(p.img.amount))
        : Promise.resolve(null),
      p.img.storeName ? deps.crypto.encrypt(tenantId, p.img.storeName) : Promise.resolve(null),
      input.handoffText && input.handoffText.trim()
        ? deps.crypto.encrypt(tenantId, input.handoffText.trim())
        : Promise.resolve(null),
    ]);

    const receiptRecord = await deps.receipts.create({
      tenantId,
      staffId: input.staffId,
      customerId: input.customerId,
      receiptTimestamp: parseJstTimestampString(p.timestamp),
      dedupeBlindIndex: p.dedupeBlindIndex,
      amount: amountEnc,
      storeName: storeNameEnc,
      handoffText: handoffEnc,
      fileKey,
      contentType: decoded.contentType,
    });
    await deps.mirror.enqueue({
      tenantId,
      kind: 'receipt',
      targetId: receiptRecord.id,
      idempotencyKey: randomUUID(),
    });

    registeredImages.push({
      amount: normalizeText(String(p.img.amount ?? '')),
      storeName: normalizeText(p.img.storeName),
    });
    uploadedCount++;
  }

  let message = `領収書を${uploadedCount}件アップロードしました`;
  if (duplicates.length > 0) message += `(重複${duplicates.length}件は登録しませんでした)`;

  if (uploadedCount > 0) {
    const staffRecord = await deps.staff.findById(tenantId, input.staffId);
    const staffName = staffRecord ? staffRecord.name : '不明';
    const customerRecord = input.customerId
      ? await deps.customers.findById(tenantId, input.customerId)
      : null;
    const customerName = customerRecord ? customerRecord.name : null;

    const notificationText = buildReceiptNotificationText({
      staffName,
      customerName,
      receiptTimestamp: input.fallbackTimestamp,
      registeredImages,
      handoffText: input.handoffText || '',
    });
    await deps.notifier.notify(tenantId, 'receipt', notificationText);
  }

  return { success: true, message, uploadedCount, duplicateCount: duplicates.length, duplicates };
}
