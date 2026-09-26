import {
  type CancelReceiptRequest,
  cancelReceiptResponseSchema,
  receiptListResponseSchema,
  receiptOcrResponseSchema,
  type UploadReceiptsRequest,
  uploadReceiptsResponseSchema,
} from '@katahimo/shared';
import { api } from './client';

/** 領収書の一覧の条件(staffId は管理者・コーディネーターだけ有効。allStaff は全スタッフ分)。 */
export interface ReceiptListFilters {
  month: string;
  staffId?: string | undefined;
  allStaff?: boolean;
}

function listQuery(filters: ReceiptListFilters): Record<string, string> {
  const query: Record<string, string> = { month: filters.month };
  if (filters.allStaff) query.allStaff = 'true';
  else if (filters.staffId) query.staffId = filters.staffId;
  return query;
}

/** 領収書のAPI(GAS版 extractAmountFromImage / uploadReceiptsOnly と、領収書の一覧・画像)。 */
export const receiptsApi = {
  /** POST /api/receipts/ocr: 写真1枚から金額・お店の名前・日時を読む(読めなくても空の値で返る) */
  ocr: (image: string) => api.post('/api/receipts/ocr', receiptOcrResponseSchema, { image }),
  /** POST /api/receipts: 領収書を送る(customerId が null なら「お客様の指定なし」) */
  upload: (body: UploadReceiptsRequest) => api.post('/api/receipts', uploadReceiptsResponseSchema, body),
  /** GET /api/receipts: 月の領収書の一覧(新しい順に50件ずつ)と月全体の合計 */
  list: (filters: ReceiptListFilters, cursor: string | undefined, signal?: AbortSignal) =>
    api.get(
      '/api/receipts',
      receiptListResponseSchema,
      { ...listQuery(filters), ...(cursor ? { cursor } : {}), limit: 50 },
      { signal },
    ),
  /** 画像の URL(同じオリジンの Cookie で <img> がそのまま読める。CSP の img-src 'self') */
  imageUrl: (receiptId: string) => `/api/receipts/${encodeURIComponent(receiptId)}/image`,
  /** POST /api/receipts/:id/cancel: 取消(論理削除。一覧に灰色で残る)。応答は取消した後の行 */
  cancel: (receiptId: string, body: CancelReceiptRequest) =>
    api.post(`/api/receipts/${encodeURIComponent(receiptId)}/cancel`, cancelReceiptResponseSchema, body),
  /** GET /api/receipts/csv: 月の全件の CSV(管理者・コーディネーターだけ。断られたら理由つきのエラー) */
  downloadCsv: (filters: ReceiptListFilters) =>
    api.download('/api/receipts/csv', listQuery(filters), 'text/csv', `領収書_${filters.month}.csv`),
};
