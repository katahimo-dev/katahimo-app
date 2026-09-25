import { extractReceiptAmount, resolveReceiptFallbackTimestamp, uploadReceipts } from '@katahimo/core';
import { uploadReceiptsRequestSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { requireSession } from '../session';

const ocrRequestSchema = z.object({ image: z.string().min(1, 'image が必要です') });

export function createReceiptRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 領収書画像1枚から金額・店舗名・日時をOCR抽出する。GAS版extractAmountFromImage。 */
  app.post('/ocr', requireSession(container), async (c) => {
    const body = await parseJsonBody(c, ocrRequestSchema);
    if (!body.ok) return body.response;
    const result = await extractReceiptAmount(container, c.get('session'), body.data.image);
    return c.json({ result });
  });

  /**
   * 領収書画像をアップロードする。GAS版uploadReceiptsOnly(日報画面からの送信と、
   * 「お客様の指定なし」で開く単独の領収書画面(openStandaloneReceiptModal)の両方)。
   */
  app.post('/', requireSession(container, 'receipt.upload'), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, uploadReceiptsRequestSchema);
    if (!body.ok) return body.response;
    const { data } = body;

    const result = await uploadReceipts(container, session.tenantId, {
      actor: { staffId: session.staffId, isAdmin: session.isAdmin },
      requestedStaffId: data.staffId,
      customerId: data.customerId ?? null,
      customerNameText: data.customerNameText,
      images: data.images,
      fallbackTimestamp: resolveReceiptFallbackTimestamp(data, new Date()),
      handoffText: data.handoffText,
      meta: requestMeta(c),
    });
    if (!result.ok) {
      if (result.reason === 'no_images')
        return apiError(c, 400, 'validation_failed', '領収書画像がありません。');
      return apiError(
        c,
        404,
        'not_found',
        result.reason === 'customer_not_found' ? '顧客が見つかりません' : 'スタッフが見つかりません',
      );
    }
    const { ok: _ok, ...summary } = result;
    return c.json({ success: true as const, ...summary });
  });

  return app;
}
