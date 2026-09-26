import {
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
  /** CSV のダウンロード先(管理者・コーディネーターだけ) */
  csvUrl: (filters: ReceiptListFilters) => `/api/receipts/csv?${new URLSearchParams(listQuery(filters))}`,
};
