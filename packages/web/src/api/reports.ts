import {
  customerDetailResponseSchema,
  type GenerateReportRequest,
  generateAccidentReportResponseSchema,
  generateDailyReportResponseSchema,
  idSchema,
  type SaveAccidentReportRequest,
  type SaveDailyReportRequest,
  saveAccidentReportResponseSchema,
  saveDailyReportResponseSchema,
  type VisitCompleteRequest,
  visitCompleteResponseSchema,
} from '@katahimo/shared';
import { z } from 'zod';
import { api } from './client';

/**
 * 日報・事故報告のAPI(GAS版 generateReportWithWarnings / generateAccidentReport / saveReport /
 * saveAccidentReport / sendVisitCompleteNotification)。
 */
export const reportsApi = {
  /** POST /api/reports/daily/generate: メモから日報の下書きを作る(失敗しても warnings に理由を入れて返る) */
  generateDaily: (body: GenerateReportRequest) =>
    api.post('/api/reports/daily/generate', generateDailyReportResponseSchema, body),
  /** POST /api/reports/accident/generate: メモから事故報告書の下書きを作る(失敗時は draft.error) */
  generateAccident: (body: GenerateReportRequest) =>
    api.post('/api/reports/accident/generate', generateAccidentReportResponseSchema, body),
  /** POST /api/reports/daily: 日報を保存する(reportId を渡すと上書き) */
  saveDaily: (body: SaveDailyReportRequest) =>
    api.post('/api/reports/daily', saveDailyReportResponseSchema, body),
  /** POST /api/reports/accident: 事故報告・ヒヤリハットを保存する(reportId を渡すと上書き) */
  saveAccident: (body: SaveAccidentReportRequest) =>
    api.post('/api/reports/accident', saveAccidentReportResponseSchema, body),
  /** POST /api/reports/visit-complete: 「訪問終わりました」を事務局に知らせる */
  visitComplete: (body: VisitCompleteRequest) =>
    api.post('/api/reports/visit-complete', visitCompleteResponseSchema, body),
};

/**
 * 日報ダイアログが読むお客様の情報(読み取りだけ)。お客様の一覧・詳細のAPIそのものは
 * お客様タブの担当のものなので、日報ダイアログに要る項目だけをここで読む。
 */
const customerListItemSchema = z.object({ id: idSchema, name: z.string() });
/** GET /api/customers の応答のうち日報ダイアログが使う部分(一覧の契約は shared にまだ無い) */
export const reportCustomerListResponseSchema = z.object({ customers: z.array(customerListItemSchema) });

export const reportCustomersApi = {
  /** GET /api/customers/:id: 見出しの住所・「対象のお子様」の一覧に使う */
  detail: (customerId: string, signal?: AbortSignal) =>
    api.get(`/api/customers/${encodeURIComponent(customerId)}`, customerDetailResponseSchema, undefined, {
      signal,
    }),
  /** GET /api/customers: 書きかけの日報のお客様がまだいるかを確かめる(GAS版 restoreReportDraftIfAny) */
  list: (signal?: AbortSignal) =>
    api.get('/api/customers', reportCustomerListResponseSchema, undefined, { signal }),
};
