import { decodeReceiptImage, resolveReceiptFallbackTimestamp } from '@katahimo/core/domain';
import type { ReceiptListItemView } from '@katahimo/core/usecases';
import {
  exportReceipts,
  extractReceiptAmount,
  getReceiptImage,
  listReceipts,
  uploadReceipts,
} from '@katahimo/core/usecases';
import {
  formatZonedDateTime,
  idSchema,
  RECEIPT_IMAGE_MAX_BYTES,
  receiptListQuerySchema,
  receiptListResponseSchema,
  receiptOcrRequestSchema,
  receiptOcrResponseSchema,
  uploadReceiptsRequestSchema,
  uploadReceiptsResponseSchema,
} from '@katahimo/shared';
import { type Context, Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { Container } from '../container';
import { csvLine, writeCsvStream } from '../http/csv';
import { enforceStaffQuota } from '../http/quota';
import { requestIdOf } from '../http/requestLog';
import { apiError, jsonOk, parseJsonBody, parseQuery } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireSession, targetStaffIdOf } from '../session';

/** 画像の検証に失敗したときの案内(JPEG・PNG・WebP、1枚1.5MBまで)。 */
const INVALID_IMAGE_MESSAGE = '領収書画像の形式が正しくないか、大きすぎます(JPEG・PNG・WebP、1枚1.5MBまで)。';

const CSV_HEADER = [
  '領収書日時',
  'スタッフ',
  'お客様',
  '金額(円)',
  '店名',
  '申し送り',
  '登録の束ID',
  '領収書ID',
];

/** CSV の1行。お客様の指定なしは「(指定なし)」、金額が無ければ空。 */
export function receiptCsvLine(item: ReceiptListItemView, timeZone: string): string {
  return csvLine([
    formatZonedDateTime(item.receiptedAt, timeZone),
    item.staffName ?? '(削除されたスタッフ)',
    item.customerName ?? '(指定なし)',
    item.amountYen === null ? '' : String(item.amountYen),
    item.storeName ?? '',
    item.handoffText ?? '',
    item.uploadBatchId,
    item.id,
  ]);
}

/** 一覧・CSV の条件を usecase の条件にする(対象スタッフは admin-vs-self で決める)。 */
function listCriteria(
  c: Context<SessionEnv>,
  query: { month: string; staffId?: string | undefined; allStaff: boolean; customerId?: string | undefined },
) {
  return {
    yearMonth: query.month,
    allStaff: query.allStaff,
    targetStaffId: targetStaffIdOf(c, query.staffId),
    customerId: query.customerId,
  };
}

export function createReceiptRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /**
   * 領収書の一覧(月・領収書日時の新しい順・keyset ページング)と月全体の合計。一般スタッフは本人の分だけ
   * (staffId は無視、allStaff は 403)。管理者・コーディネーターは他のスタッフ・全スタッフ分も見られる。
   */
  app.get('/', requireSession(container, 'receipt.list'), async (c) => {
    const query = parseQuery(c, receiptListQuerySchema);
    if (!query.ok) return query.response;
    const page = await listReceipts(container, actorOf(c), {
      ...listCriteria(c, query.data),
      cursor: query.data.cursor,
      limit: query.data.limit,
    });
    return jsonOk(c, receiptListResponseSchema, page);
  });

  /** 一覧の CSV(管理者・コーディネーターだけ。条件に合う全件、BOM つき UTF-8)。 */
  app.get('/csv', requireSession(container, 'receipt.export'), async (c) => {
    const query = parseQuery(c, receiptListQuerySchema);
    if (!query.ok) return query.response;
    const exported = await exportReceipts(container, actorOf(c), listCriteria(c, query.data));
    const scope = exported.staff ? 'staff' : 'all';
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="receipts_${exported.yearMonth}_${scope}.csv"`);
    const requestId = requestIdOf(c);
    return stream(c, (out) =>
      writeCsvStream(out, {
        header: CSV_HEADER,
        batches: exported.receipts(),
        toLine: (item) => receiptCsvLine(item, exported.timeZone),
        requestId,
        failureMessage: '領収書の CSV の書き出しが途中で失敗しました',
      }),
    );
  });

  /**
   * 領収書の画像(本人の分、管理者・コーディネーターは全員の分)。署名付きURLへの転送ではなく API が中身を返す
   * (同一オリジンの Cookie で認可でき、CSP の img-src 'self' のまま、URL が漏れても使えない。doc/06)。
   * ブラウザ・中継に残さないよう private, no-store。種類は中身の先頭バイトで判定したもの。
   */
  app.get('/:id/image', requireSession(container, 'receipt.image'), async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return apiError(c, 404, 'not_found', '領収書が見つかりません。');
    const image = await getReceiptImage(container, actorOf(c), id.data);
    return c.body(image.bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  });

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
