import { randomUUID } from 'node:crypto';
import { RECEIPT_IMAGE_MAX_BYTES, RECEIPT_MAX_IMAGES } from '@katahimo/shared';
import {
  buildReceiptDedupeKey,
  buildReceiptNotificationText,
  canCheckReceiptDuplicate,
  decodeReceiptImage,
  ENCRYPTION_PURPOSES,
  normalizeAmount,
  normalizeText,
  parseJstTimestampString,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { BlindIndexPort, CryptoPort, EncryptedValue, EncryptionPurpose } from '../ports/crypto';
import type { MirrorPort } from '../ports/mirror';
import type { NotifierPort } from '../ports/notifier';
import type {
  CustomerRepositoryPort,
  ReceiptRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { StoragePort } from '../ports/storage';
import { notifyWithLog } from './notify';
import type { Actor, RequestMeta } from './requestMeta';

export interface ReceiptDeps {
  receipts: ReceiptRepositoryPort;
  staff: StaffRepositoryPort;
  customers: CustomerRepositoryPort;
  crypto: CryptoPort;
  blindIndex: BlindIndexPort;
  storage: StoragePort;
  notifier: NotifierPort;
  /** 領収書ログシート+Driveフォルダへのミラー書き込み要求をoutboxに積む。 */
  mirror: MirrorPort;
  appLog: AppLogPort;
}

export interface ReceiptImageInput {
  /** data URL('data:image/jpeg;base64,...')。 */
  data: string;
  amount?: string | number | null;
  storeName?: string | null;
  /** OCRで取得した領収書日時('yyyy/MM/dd HH:mm'等)。無ければfallbackTimestampを使う。 */
  receiptDate?: string | null;
}

export interface UploadReceiptsInput {
  actor: Actor;
  /** 管理者が他スタッフ名義で登録する場合のみ有効。 */
  requestedStaffId?: string;
  /** nullは「お客様の指定なし」の領収書(GAS版openStandaloneReceiptModal)。 */
  customerId: string | null;
  /** 顧客マスタに無いお客様の氏名。customerIdがある場合は無視する。 */
  customerNameText?: string;
  images: ReceiptImageInput[];
  /** 'yyyy/MM/dd HH:mm:ss'。画像にreceiptDateが無い場合の日時(resolveReceiptFallbackTimestamp参照)。 */
  fallbackTimestamp: string;
  /** 申し送り。1回のアップロードに1つだけで、バッチ先頭の行にだけ保存する。 */
  handoffText: string;
  meta?: RequestMeta;
}

export interface ReceiptDuplicateInfo {
  index: number;
  timestamp: string;
  amount: string;
  storeName: string;
}

export interface UploadReceiptsSummary {
  message: string;
  uploadedCount: number;
  duplicateCount: number;
  duplicates: ReceiptDuplicateInfo[];
  /** 今回の登録で採番したバッチID。1件も登録しなかった場合はnull。 */
  uploadBatchId: string | null;
}

export type UploadReceiptsResult =
  | ({ ok: true } & UploadReceiptsSummary)
  | { ok: false; reason: 'no_images' | 'too_many_images' | 'staff_not_found' | 'customer_not_found' }
  | {
      ok: false;
      reason: 'invalid_image';
      index: number;
      detail: 'malformed' | 'too_large' | 'unsupported_type';
    };

function encryptOptional(
  deps: ReceiptDeps,
  tenantId: string,
  value: string,
  purpose: EncryptionPurpose,
): Promise<EncryptedValue | null> {
  return value ? deps.crypto.encrypt(tenantId, value, purpose) : Promise.resolve(null);
}

/**
 * 領収書画像をアップロードする。GAS版Main.js uploadReceiptsOnly/processReceiptImagesに対応。
 *
 * - 担当スタッフは管理者以外は本人に固定する(CLAUDE.mdのadmin-vs-selfパターン)。
 * - 「スタッフ・顧客・日時・金額・店舗名」が既存の登録と全て一致する画像は重複として登録しない
 *   (金額または店舗名が未入力の画像は判定しない。同じ操作内の同一内容は往復運賃等のため全件登録する)。
 * - 1回の操作で登録した行は同じupload_batch_idを持ち、申し送りは最初に登録した行にだけ保存する。
 * - 1件以上登録できたらGoogle Chatへ通知する(GAS版sendReceiptNotification)。
 */
export async function uploadReceipts(
  deps: ReceiptDeps,
  tenantId: string,
  input: UploadReceiptsInput,
): Promise<UploadReceiptsResult> {
  if (input.images.length === 0) return { ok: false, reason: 'no_images' };
  if (input.images.length > RECEIPT_MAX_IMAGES) return { ok: false, reason: 'too_many_images' };
  // 1枚でも不正な画像があれば何も保存しない(中身の先頭バイトで種類を判定し、保存する種類・拡張子もそれに合わせる)
  const decodedImages = [];
  for (const [index, img] of input.images.entries()) {
    const decoded = decodeReceiptImage(img.data, RECEIPT_IMAGE_MAX_BYTES);
    if (!decoded.ok) return { ok: false, reason: 'invalid_image', index, detail: decoded.reason };
    decodedImages.push(decoded);
  }

  const staffId = input.actor.isAdmin
    ? input.requestedStaffId?.trim() || input.actor.staffId
    : input.actor.staffId;
  const [staff, customer] = await Promise.all([
    deps.staff.findById(tenantId, staffId),
    input.customerId ? deps.customers.findById(tenantId, input.customerId) : Promise.resolve(null),
  ]);
  if (!staff) return { ok: false, reason: 'staff_not_found' };
  if (input.customerId && !customer) return { ok: false, reason: 'customer_not_found' };
  const customerNameText = customer ? null : normalizeText(input.customerNameText) || null;

  const candidates = await Promise.all(
    input.images.map(async (img, index) => {
      const timestamp = normalizeText(img.receiptDate) || input.fallbackTimestamp;
      const dedupeBlindIndex = canCheckReceiptDuplicate({ amount: img.amount, storeName: img.storeName })
        ? await deps.blindIndex.compute(
            tenantId,
            buildReceiptDedupeKey({
              timestamp,
              staffId,
              customerId: input.customerId ?? '',
              amount: img.amount,
              storeName: img.storeName,
            }),
          )
        : null;
      return { index, img, timestamp, dedupeBlindIndex };
    }),
  );
  const existing = await deps.receipts.findExistingDedupeIndexes(
    tenantId,
    candidates.map((c) => c.dedupeBlindIndex).filter((v): v is string => v !== null),
  );

  const uploadBatchId = randomUUID();
  const handoffText = input.handoffText.trim();
  const duplicates: ReceiptDuplicateInfo[] = [];
  const registered: { amount: string; storeName: string }[] = [];

  for (const c of candidates) {
    if (c.dedupeBlindIndex && existing.has(c.dedupeBlindIndex)) {
      duplicates.push({
        index: c.index,
        timestamp: c.timestamp,
        amount: normalizeAmount(c.img.amount),
        storeName: normalizeText(c.img.storeName),
      });
      continue;
    }
    const decoded = decodedImages[c.index];
    if (!decoded) continue;

    const fileKey = `${tenantId}/receipts/${randomUUID()}.${decoded.extension}`;
    await deps.storage.put(fileKey, decoded.contentType, decoded.bytes);

    const amount = normalizeText(c.img.amount == null ? '' : String(c.img.amount));
    const storeName = normalizeText(c.img.storeName);
    const isFirst = registered.length === 0;
    const [amountEnc, storeNameEnc, handoffEnc] = await Promise.all([
      encryptOptional(deps, tenantId, amount, ENCRYPTION_PURPOSES.receiptAmount),
      encryptOptional(deps, tenantId, storeName, ENCRYPTION_PURPOSES.receiptStoreName),
      encryptOptional(deps, tenantId, isFirst ? handoffText : '', ENCRYPTION_PURPOSES.receiptHandoffText),
    ]);

    const receipt = await deps.receipts.create({
      tenantId,
      staffId,
      customerId: customer?.id ?? null,
      customerNameText,
      uploadBatchId,
      receiptTimestamp: parseJstTimestampString(c.timestamp),
      dedupeBlindIndex: c.dedupeBlindIndex,
      amount: amountEnc,
      storeName: storeNameEnc,
      handoffText: handoffEnc,
      fileKey,
      contentType: decoded.contentType,
    });
    await deps.mirror.enqueue({
      tenantId,
      kind: 'receipt',
      targetId: receipt.id,
      idempotencyKey: randomUUID(),
    });
    registered.push({ amount, storeName });
  }

  let message = `領収書を${registered.length}件アップロードしました`;
  if (duplicates.length > 0) message += `（重複${duplicates.length}件は登録しませんでした）`;

  if (registered.length > 0) {
    await notifyWithLog(
      deps,
      tenantId,
      'receipt',
      buildReceiptNotificationText({
        staffName: staff.name,
        customerName: customer?.name ?? customerNameText,
        receiptTimestamp: input.fallbackTimestamp,
        registeredImages: registered,
        handoffText,
      }),
      input.actor.staffId,
    );
  }

  await deps.appLog.write({
    tenantId,
    level: 'INFO',
    action: 'receipt.uploaded',
    actorStaffId: input.actor.staffId,
    targetStaffId: staffId === input.actor.staffId ? null : staffId,
    details: {
      uploadBatchId: registered.length > 0 ? uploadBatchId : null,
      customerId: customer?.id ?? null,
      standalone: !customer,
      uploadedCount: registered.length,
      duplicateCount: duplicates.length,
    },
    ...input.meta,
  });

  return {
    ok: true,
    message,
    uploadedCount: registered.length,
    duplicateCount: duplicates.length,
    duplicates,
    uploadBatchId: registered.length > 0 ? uploadBatchId : null,
  };
}
