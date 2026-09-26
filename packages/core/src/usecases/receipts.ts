import { createHash } from 'node:crypto';
import { RECEIPT_IMAGE_MAX_BYTES, RECEIPT_MAX_IMAGES } from '@katahimo/shared';
import {
  buildReceiptDedupeKey,
  buildReceiptNotificationText,
  canCheckReceiptDuplicate,
  decodeReceiptImage,
  invalid,
  newId,
  normalizeAmount,
  normalizeText,
  notFound,
  outboxDedupeKey,
  parseJstTimestamp,
  receiptDedupeHash,
  resolveTargetStaffId,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { NotifierPort } from '../ports/notifier';
import type { StoragePort } from '../ports/storage';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import { notifyWithLog } from './notify';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface ReceiptDeps extends Clock {
  uow: UnitOfWorkPort;
  storage: StoragePort;
  notifier: NotifierPort;
  appLog: AppLogPort;
}

export interface ReceiptImageInput {
  /** data URL('data:image/jpeg;base64,...')。 */
  data: string;
  amount?: string | number | null | undefined;
  storeName?: string | null | undefined;
  /** OCRで取得した領収書日時('yyyy/MM/dd HH:mm'等)。無ければ fallbackTimestamp を使う。 */
  receiptDate?: string | null | undefined;
}

export interface UploadReceiptsInput {
  /** 他のスタッフの名義で登録する場合(管理者・コーディネーターのみ有効)。 */
  requestedStaffId?: string | undefined;
  /** null は「お客様の指定なし」の領収書(GAS版 openStandaloneReceiptModal)。 */
  customerId: string | null;
  /** 顧客マスタに無いお客様の氏名。customerId がある場合は無視する。 */
  customerNameText?: string | undefined;
  images: ReceiptImageInput[];
  /** 'yyyy/MM/dd HH:mm:ss'。画像に receiptDate が無い場合の日時。 */
  fallbackTimestamp: string;
  /** 申し送り。1回のアップロードに1つだけ(receipt_uploads に置く)。 */
  handoffText: string;
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
  /** 今回の登録の束のID。1件も登録しなかった場合は null。 */
  uploadBatchId: string | null;
}

const INVALID_IMAGE_MESSAGE = '領収書画像の形式が正しくないか、大きすぎます(JPEG・PNG・WebP、1枚1.5MBまで)。';

/** 金額の入力を円の整数にする(「1,200」「1200円」等。読めなければ null)。 */
export function parseAmountYen(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[,，\s円¥￥]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * 領収書画像を登録する(GAS版 Main.js uploadReceiptsOnly / processReceiptImages)。
 *
 * - 担当スタッフは、他人を扱えないロールでは本人に固定する(CLAUDE.md の admin-vs-self)。
 * - 画像は先にファイル置き場へ保存し、1トランザクションで stored_files・receipt_uploads・receipts・outbox を書く。
 *   トランザクションが失敗したら保存した画像を消す。
 * - 「スタッフ・顧客・日時・金額・店名」が既存の登録と一致する画像は重複として登録しない。判定は dedupe_hash の
 *   部分UNIQUE と INSERT … ON CONFLICT DO NOTHING で行い、同時の登録でも1件だけが残る。金額か店名が未入力の画像は
 *   判定しない。同じ操作の中の同じ内容(往復の運賃等)は全て登録する(dedupe_hash を持つのは束の最初の1枚だけ)。
 *   最初の1枚が既存と重複したら、同じ内容の残りの画像も全て重複にする(GAS版と同じく、同じ束を送り直しても
 *   1枚も増えない)。
 * - 1件以上登録できたら Google Chat へ通知する(GAS版 sendReceiptNotification)。
 */
export async function uploadReceipts(
  deps: ReceiptDeps,
  actor: Actor,
  input: UploadReceiptsInput,
): Promise<UploadReceiptsSummary> {
  if (input.images.length === 0) throw invalid('領収書画像がありません。');
  if (input.images.length > RECEIPT_MAX_IMAGES)
    throw invalid(`領収書画像は${RECEIPT_MAX_IMAGES}枚までです。`);
  const decoded = input.images.map((img, index) => {
    const result = decodeReceiptImage(img.data, RECEIPT_IMAGE_MAX_BYTES);
    if (!result.ok) {
      throw invalid(
        INVALID_IMAGE_MESSAGE,
        { [`images.${index}.data`]: INVALID_IMAGE_MESSAGE },
        result.reason,
      );
    }
    return result;
  });
  const tenantId = actor.tenantId;
  const staffId = resolveTargetStaffId(actor, input.requestedStaffId);

  const seenKeys = new Set<string>();
  const withKeys = input.images.map((img, index) => {
    const timestamp = normalizeText(img.receiptDate) || input.fallbackTimestamp;
    const key = canCheckReceiptDuplicate({ amount: img.amount, storeName: img.storeName })
      ? buildReceiptDedupeKey({
          timestamp,
          staffId,
          customerId: input.customerId ?? '',
          amount: img.amount,
          storeName: img.storeName,
        })
      : null;
    // 同じ操作の中の2枚目以降の同じ内容は判定しない(全て登録する)
    const first = key !== null && !seenKeys.has(key);
    if (key) seenKeys.add(key);
    return {
      index,
      img,
      timestamp,
      key,
      fileId: newId(),
      receiptId: newId(),
      dedupeHash: first && key ? receiptDedupeHash(key) : null,
    };
  });

  const stored = await Promise.all(
    withKeys.map(async (c) => {
      const image = decoded[c.index] as Extract<(typeof decoded)[number], { ok: true }>;
      const storageKey = `${tenantId}/receipts/${c.fileId}.${image.extension}`;
      await deps.storage.put(storageKey, image.contentType, image.bytes);
      return { ...c, image, storageKey };
    }),
  );
  const uploadId = newId();
  const handoffText = input.handoffText.trim();

  let outcome: {
    staffName: string;
    customerName: string | null;
    registered: typeof stored;
    duplicates: typeof stored;
  };
  try {
    outcome = await deps.uow.run(
      tenantId,
      async (r) => {
        const [staff, customer] = await Promise.all([
          r.staff.findById(staffId),
          input.customerId ? r.customers.findById(input.customerId) : Promise.resolve(null),
        ]);
        if (!staff) throw notFound('スタッフが見つかりません');
        if (input.customerId && !customer) throw notFound('顧客が見つかりません');
        const customerNameText = customer ? null : normalizeText(input.customerNameText) || null;
        await r.receipts.createUpload({
          id: uploadId,
          staffId,
          customerId: customer?.id ?? null,
          customerNameText,
          handoffText: handoffText || null,
          createdBy: actor.staffId,
        });
        const registered: typeof stored = [];
        const duplicates: typeof stored = [];
        // 既存と重複した内容(束の最初の1枚が弾かれたキー)。同じ内容の残りの画像も登録しない
        const duplicateKeys = new Set<string>();
        for (const c of stored) {
          if (c.key !== null && duplicateKeys.has(c.key)) {
            duplicates.push(c);
            continue;
          }
          await r.storedFiles.insert({
            id: c.fileId,
            storageKey: c.storageKey,
            contentType: c.image.contentType,
            byteSize: c.image.bytes.length,
            sha256: createHash('sha256').update(c.image.bytes).digest(),
            purpose: 'receipt_image',
            createdBy: actor.staffId,
          });
          const inserted = await r.receipts.insertIfNew({
            id: c.receiptId,
            uploadId,
            fileId: c.fileId,
            staffId,
            customerId: customer?.id ?? null,
            customerNameText,
            // 読めない領収書日時は GAS版と同じくフォールバックの日時(報告の日付+開始時刻等)、それも読めなければ登録時刻
            receiptedAt:
              parseJstTimestamp(c.timestamp) ??
              parseJstTimestamp(input.fallbackTimestamp) ??
              currentTime(deps),
            amountYen: parseAmountYen(c.img.amount),
            storeName: normalizeText(c.img.storeName) || null,
            dedupeHash: c.dedupeHash,
          });
          if (!inserted) {
            await r.storedFiles.delete(c.fileId);
            if (c.key !== null) duplicateKeys.add(c.key);
            duplicates.push(c);
            continue;
          }
          await r.outbox.enqueue({
            topic: 'mirror.receipt',
            aggregateType: 'receipt',
            aggregateId: c.receiptId,
            dedupeKey: outboxDedupeKey('mirror.receipt', c.receiptId, 0),
          });
          registered.push(c);
        }
        return {
          staffName: staff.displayName,
          customerName: customer?.displayName ?? customerNameText,
          registered,
          duplicates,
        };
      },
      { actorId: actor.staffId },
    );
  } catch (error) {
    await Promise.all(stored.map((c) => deps.storage.delete(c.storageKey).catch(() => undefined)));
    throw error;
  }
  await Promise.all(outcome.duplicates.map((c) => deps.storage.delete(c.storageKey).catch(() => undefined)));

  const registeredImages = outcome.registered.map((c) => ({
    amount: normalizeText(c.img.amount == null ? '' : String(c.img.amount)),
    storeName: normalizeText(c.img.storeName),
  }));
  let message = `領収書を${registeredImages.length}件アップロードしました`;
  if (outcome.duplicates.length > 0) message += `（重複${outcome.duplicates.length}件は登録しませんでした）`;
  if (registeredImages.length > 0) {
    await notifyWithLog(
      deps,
      tenantId,
      'receipt',
      buildReceiptNotificationText({
        staffName: outcome.staffName,
        customerName: outcome.customerName,
        receiptTimestamp: input.fallbackTimestamp,
        registeredImages,
        handoffText,
      }),
      actor.staffId,
    );
  }
  await deps.appLog.write({
    tenantId,
    level: 'INFO',
    action: 'receipt.uploaded',
    actorStaffId: actor.staffId,
    targetStaffId: staffId === actor.staffId ? null : staffId,
    details: {
      uploadBatchId: uploadId,
      customerId: input.customerId,
      standalone: !input.customerId,
      uploadedCount: registeredImages.length,
      duplicateCount: outcome.duplicates.length,
    },
    ...actor.meta,
  });
  return {
    message,
    uploadedCount: registeredImages.length,
    duplicateCount: outcome.duplicates.length,
    duplicates: outcome.duplicates.map((c) => ({
      index: c.index,
      timestamp: c.timestamp,
      amount: normalizeAmount(c.img.amount),
      storeName: normalizeText(c.img.storeName),
    })),
    uploadBatchId: registeredImages.length > 0 ? uploadId : null,
  };
}
