import {
  type GenerateReportRequest,
  generateAccidentReportResponseSchema,
  generateDailyReportResponseSchema,
  type SaveAccidentReportRequest,
  type SaveDailyReportRequest,
  saveAccidentReportResponseSchema,
  saveDailyReportResponseSchema,
  type VisitCompleteRequest,
  visitCompleteResponseSchema,
} from '@katahimo/shared';
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
