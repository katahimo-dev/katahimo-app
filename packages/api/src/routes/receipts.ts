import { extractReceiptAmount, uploadReceipts } from '@katahimo/core';
import { formatJstDateTime } from '@katahimo/core/domain';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveReportTargetStaffId } from '../session';

export function createReceiptRoutes(container: Container) {
  const app = new Hono();

  /** 領収書画像1枚から金額・店舗名・日時をOCR抽出する。GAS版extractAmountFromImage相当。 */
  app.post('/ocr', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.image !== 'string' || !body.image) {
      return c.json({ code: 'validation_failed', message: 'image が必要です' }, 400);
    }

    const result = await extractReceiptAmount(container, session.tenantId, body.image);
    return c.json({ result });
  });

  /** 領収書画像をアップロードする。GAS版uploadReceiptsOnly相当。 */
  app.post('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body?.images) || body.images.length === 0) {
      return c.json({ success: false, message: '領収書画像がありません。' });
    }

    const staffId = resolveReportTargetStaffId(session, body.staffId);
    const images = body.images
      .filter((img: unknown): img is Record<string, unknown> => typeof img === 'object' && img !== null)
      .map((img: Record<string, unknown>) => ({
        data: typeof img.data === 'string' ? img.data : '',
        amount: typeof img.amount === 'string' || typeof img.amount === 'number' ? img.amount : null,
        storeName: typeof img.storeName === 'string' ? img.storeName : null,
        receiptDate: typeof img.receiptDate === 'string' ? img.receiptDate : null,
      }))
      .filter((img: { data: string }) => img.data);

    const result = await uploadReceipts(container, session.tenantId, {
      staffId,
      customerId: typeof body.customerId === 'string' && body.customerId ? body.customerId : null,
      images,
      fallbackTimestamp:
        typeof body.receiptTimestamp === 'string' && body.receiptTimestamp
          ? body.receiptTimestamp
          : formatJstDateTime(new Date()),
      handoffText: typeof body.handoffText === 'string' ? body.handoffText : '',
    });
    return c.json(result);
  });

  return app;
}
