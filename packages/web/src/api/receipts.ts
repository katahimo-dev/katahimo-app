import {
  receiptOcrResponseSchema,
  type UploadReceiptsRequest,
  uploadReceiptsResponseSchema,
} from '@katahimo/shared';
import { api } from './client';

/** 領収書のAPI(GAS版 extractAmountFromImage / uploadReceiptsOnly)。 */
export const receiptsApi = {
  /** POST /api/receipts/ocr: 写真1枚から金額・お店の名前・日時を読む(読めなくても空の値で返る) */
  ocr: (image: string) => api.post('/api/receipts/ocr', receiptOcrResponseSchema, { image }),
  /** POST /api/receipts: 領収書を送る(customerId が null なら「お客様の指定なし」) */
  upload: (body: UploadReceiptsRequest) => api.post('/api/receipts', uploadReceiptsResponseSchema, body),
};
