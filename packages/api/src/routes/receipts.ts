import { decodeReceiptImage, resolveReceiptFallbackTimestamp } from '@katahimo/core/domain';
import { extractReceiptAmount, uploadReceipts } from '@katahimo/core/usecases';
import {
  RECEIPT_IMAGE_MAX_BYTES,
  receiptOcrRequestSchema,
  receiptOcrResponseSchema,
  uploadReceiptsRequestSchema,
  uploadReceiptsResponseSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { enforceStaffQuota } from '../http/quota';
import { apiError, jsonOk, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireSession } from '../session';

/** 画像の検証に失敗したときの案内(JPEG・PNG・WebP、1枚1.5MBまで)。 */
const INVALID_IMAGE_MESSAGE = '領収書画像の形式が正しくないか、大きすぎます(JPEG・PNG・WebP、1枚1.5MBまで)。';

export function createReceiptRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 領収書画像1枚から金額・店舗名・日時を OCR で読む(GAS版 extractAmountFromImage)。 */
  app.post('/ocr', requireSession(container), async (c) => {
    const body = await parseJsonBody(c, receiptOcrRequestSchema);
    if (!body.ok) return body.response;
    if (!decodeReceiptImage(body.data.image, RECEIPT_IMAGE_MAX_BYTES).ok) {
      return apiError(c, 400, 'validation_failed', INVALID_IMAGE_MESSAGE);
    }
    const limited = await enforceStaffQuota(
      c,
      container,
      container.rateLimits.receiptOcrStaff,
      '本日の領収書の読み取りの利用回数の上限に達しました。金額などを手入力してください。',
    );
    if (limited) return limited;
    const result = await extractReceiptAmount(container, c.get('session'), body.data.image);
    return jsonOk(c, receiptOcrResponseSchema, { result });
  });

  /**
   * 領収書画像を登録する(GAS版 uploadReceiptsOnly。日報画面からの送信と「お客様の指定なし」の単独の画面の両方)。
   * 重複・名義・画像の検証は usecase が行う。
   */
  app.post('/', requireSession(container, 'receipt.upload'), async (c) => {
    const body = await parseJsonBody(c, uploadReceiptsRequestSchema);
    if (!body.ok) return body.response;
    const { data } = body;
    const summary = await uploadReceipts(container, actorOf(c), {
      requestedStaffId: data.staffId,
      customerId: data.customerId ?? null,
      customerNameText: data.customerNameText,
      images: data.images,
      fallbackTimestamp: resolveReceiptFallbackTimestamp(data, new Date()),
      handoffText: data.handoffText,
    });
    return jsonOk(c, uploadReceiptsResponseSchema, { success: true, ...summary });
  });

  return app;
}
