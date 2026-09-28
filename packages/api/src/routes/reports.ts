import {
  exportReports,
  generateAccidentReportDraft,
  generateDailyReportDraft,
  getCustomerHistory,
  getReportDetail,
  listReports,
  saveAccidentReport,
  saveDailyReport,
  sendVisitCompleteNotification,
} from '@katahimo/core/usecases';
import {
  customerHistoryQuerySchema,
  customerHistoryResponseSchema,
  generateAccidentReportResponseSchema,
  generateDailyReportRequestSchema,
  generateDailyReportResponseSchema,
  generateReportRequestSchema,
  idSchema,
  reportCsvQuerySchema,
  reportDetailResponseSchema,
  reportListQuerySchema,
  reportListResponseSchema,
  saveAccidentReportRequestSchema,
  saveAccidentReportResponseSchema,
  saveDailyReportRequestSchema,
  saveDailyReportResponseSchema,
  visitCompleteRequestSchema,
  visitCompleteResponseSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { Container } from '../container';
import { enforceAiQuota } from '../http/quota';
import { requestIdOf } from '../http/requestLog';
import { apiError, jsonOk, parseJsonBody, parseQuery } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireCoordinator, requireSession } from '../session';
import { writeReportCsv } from './reportCsv';

const HISTORY_LIMIT = 5;
const AI_QUOTA_MESSAGE = '本日のAI生成の利用回数の上限に達しました。明日以降に再度お試しください。';

/**
 * 保育日報・事故報告の API(GAS版 Main.js saveReport / saveAccidentReport / getCustomerReports)。
 * 担当スタッフ・上書きの権限・顧客と担当の一致は usecase が確かめる(違反は DomainError → app.onError)。
 */
export function createReportRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 保育日報の下書きをAI生成する(GAS版 generateReportWithWarnings + 日報AIの3軸。生成の記録を残す)。 */
  app.post('/daily/generate', requireSession(container), async (c) => {
    const body = await parseJsonBody(c, generateDailyReportRequestSchema);
    if (!body.ok) return body.response;
    const limited = await enforceAiQuota(
      c,
      container,
      container.rateLimits.aiGenerateStaff,
      AI_QUOTA_MESSAGE,
    );
    if (limited) return limited;
    const result = await generateDailyReportDraft(container, actorOf(c), body.data);
    return jsonOk(c, generateDailyReportResponseSchema, result);
  });

  /** 事故報告/ヒヤリハットの下書きをAI生成する(GAS版 generateAccidentReport)。 */
  app.post('/accident/generate', requireSession(container), async (c) => {
    const body = await parseJsonBody(c, generateReportRequestSchema);
    if (!body.ok) return body.response;
    const limited = await enforceAiQuota(
      c,
      container,
      container.rateLimits.aiGenerateStaff,
      AI_QUOTA_MESSAGE,
    );
    if (limited) return limited;
    const draft = await generateAccidentReportDraft(container, actorOf(c), body.data);
    return jsonOk(c, generateAccidentReportResponseSchema, { draft });
  });

  /** 保育日報を保存する(GAS版 Main.js saveReport)。 */
  app.post('/daily', requireSession(container, 'report.daily.save'), async (c) => {
    const body = await parseJsonBody(c, saveDailyReportRequestSchema);
    if (!body.ok) return body.response;
    const { staffId, ...fields } = body.data;
    const report = await saveDailyReport(container, actorOf(c), { ...fields, requestedStaffId: staffId });
    return jsonOk(c, saveDailyReportResponseSchema, { success: true, message: '保存しました', report });
  });

  /** 事故報告/ヒヤリハットを保存する(GAS版 Main.js saveAccidentReport)。 */
  app.post('/accident', requireSession(container, 'report.accident.save'), async (c) => {
    const body = await parseJsonBody(c, saveAccidentReportRequestSchema);
    if (!body.ok) return body.response;
    const { staffId, ...fields } = body.data;
    const report = await saveAccidentReport(container, actorOf(c), { ...fields, requestedStaffId: staffId });
    return jsonOk(c, saveAccidentReportResponseSchema, { success: true, report });
  });

  /** 「訪問完了」通知のみ送信する(DB書き込みなし。GAS版 sendVisitComplete)。 */
  app.post('/visit-complete', requireSession(container), async (c) => {
    const body = await parseJsonBody(c, visitCompleteRequestSchema);
    if (!body.ok) return body.response;
    const { staffId, ...fields } = body.data;
    await sendVisitCompleteNotification(container, actorOf(c), { ...fields, requestedStaffId: staffId });
    return jsonOk(c, visitCompleteResponseSchema, { success: true });
  });

  /**
   * 顧客の活動記録(日報+事故報告)を新しい順に5件ずつ(GAS版 getCustomerReports)。続きは before に
   * 前の応答の nextCursor を渡す(キーセットページング)。
   */
  app.get('/history', requireSession(container, 'report.history.view'), async (c) => {
    const query = parseQuery(c, customerHistoryQuerySchema);
    if (!query.ok) return query.response;
    const page = await getCustomerHistory(
      container,
      actorOf(c),
      query.data.customerId,
      query.data.before ?? null,
      HISTORY_LIMIT,
    );
    return jsonOk(c, customerHistoryResponseSchema, page);
  });

  /**
   * 日報・事故報告・ヒヤリハットの一覧(新しい順、keyset ページング)。コーディネーター・管理者は全員分、
   * 一般スタッフは本人の記録だけ(staffId は無視)。
   */
  app.get('/', requireSession(container, 'report.list.view'), async (c) => {
    const query = parseQuery(c, reportListQuerySchema);
    if (!query.ok) return query.response;
    return jsonOk(c, reportListResponseSchema, await listReports(container, actorOf(c), query.data));
  });

  /**
   * 一覧と同じ条件の全件の CSV(コーディネーター・管理者だけ。GAS版の「日報」「事故報告」シートと同じ列)。
   * sheet=daily は日報、sheet=accident は事故報告・ヒヤリハット。
   */
  app.get('/export.csv', requireCoordinator(container, 'report.list.export'), async (c) => {
    const query = parseQuery(c, reportCsvQuerySchema);
    if (!query.ok) return query.response;
    const { sheet, ...criteria } = query.data;
    const exported = await exportReports(container, actorOf(c), sheet, criteria);
    const { from, to } = exported.range;
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="reports-${sheet}_${from}_${to}.csv"`);
    c.header('Cache-Control', 'no-store');
    const requestId = requestIdOf(c);
    return stream(c, (out) => writeReportCsv(out, sheet, exported.rows(), requestId));
  });

  /** 記録1件の中身(読むだけ。一般スタッフは本人の記録だけ)。 */
  app.get('/:id', requireSession(container, 'report.detail.view'), async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return apiError(c, 404, 'not_found', '報告が見つかりません');
    return jsonOk(c, reportDetailResponseSchema, await getReportDetail(container, actorOf(c), id.data));
  });

  return app;
}
