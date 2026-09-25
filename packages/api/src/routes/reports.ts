import type { SaveReportFailure } from '@katahimo/core';
import {
  generateAccidentReportDraft,
  generateDailyReportDraft,
  getCustomerHistory,
  saveAccidentReport,
  saveDailyReport,
  sendVisitCompleteNotification,
} from '@katahimo/core';
import {
  businessDateSchema,
  idSchema,
  saveAccidentReportRequestSchema,
  saveDailyReportRequestSchema,
} from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { requireSession, resolveReportTargetStaffId } from '../session';

const HISTORY_LIMIT = 5;

const generateRequestSchema = z.object({
  text: z.string().trim().min(1, 'text が必要です'),
  start: z.string().optional(),
  end: z.string().optional(),
});

const visitCompleteRequestSchema = z.object({
  staffId: idSchema.optional(),
  customerId: idSchema,
  visitDate: businessDateSchema,
  startTime: z.string(),
  endTime: z.string(),
});

function saveFailure(c: Context, reason: SaveReportFailure) {
  switch (reason) {
    case 'forbidden':
      return apiError(c, 403, 'forbidden', '他のスタッフの報告は修正できません');
    case 'report_not_found':
      return apiError(c, 404, 'not_found', '修正対象の報告が見つかりません');
    case 'customer_not_found':
      return apiError(c, 404, 'not_found', '顧客が見つかりません');
    case 'customer_mismatch':
      return apiError(c, 409, 'conflict', '別のお客様の報告は上書きできません。画面を開きなおしてください');
    case 'staff_not_found':
      return apiError(c, 404, 'not_found', 'スタッフが見つかりません');
  }
}

export function createReportRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 保育日報の下書きをAI生成する(GAS版generateReportWithWarnings)。 */
  app.post('/daily/generate', requireSession(container), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, generateRequestSchema);
    if (!body.ok) return body.response;
    const draft = await generateDailyReportDraft(container, session, body.data);
    return c.json({ draft });
  });

  /** 事故報告/ヒヤリハットの下書きをAI生成する(GAS版generateAccidentReport)。 */
  app.post('/accident/generate', requireSession(container), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, generateRequestSchema);
    if (!body.ok) return body.response;
    const draft = await generateAccidentReportDraft(container, session, body.data);
    return c.json({ draft });
  });

  /** 保育日報を保存する。GAS版Main.js saveReport。 */
  app.post('/daily', requireSession(container, 'report.daily.save'), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, saveDailyReportRequestSchema);
    if (!body.ok) return body.response;
    const { staffId, ...fields } = body.data;
    const result = await saveDailyReport(container, session.tenantId, {
      ...fields,
      actor: { staffId: session.staffId, isAdmin: session.isAdmin },
      requestedStaffId: staffId,
      meta: requestMeta(c),
    });
    if (!result.ok) return saveFailure(c, result.reason);
    return c.json({ success: true as const, message: '保存しました', report: result.report });
  });

  /** 事故報告/ヒヤリハットを保存する。GAS版Main.js saveAccidentReport。 */
  app.post('/accident', requireSession(container, 'report.accident.save'), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, saveAccidentReportRequestSchema);
    if (!body.ok) return body.response;
    const { staffId, ...fields } = body.data;
    const result = await saveAccidentReport(container, session.tenantId, {
      ...fields,
      actor: { staffId: session.staffId, isAdmin: session.isAdmin },
      requestedStaffId: staffId,
      meta: requestMeta(c),
    });
    if (!result.ok) return saveFailure(c, result.reason);
    return c.json({ success: true as const, report: result.report });
  });

  /** 「訪問完了」通知のみ送信する(DB書き込みなし)。GAS版sendVisitComplete。 */
  app.post('/visit-complete', requireSession(container), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, visitCompleteRequestSchema);
    if (!body.ok) return body.response;
    const result = await sendVisitCompleteNotification(container, session.tenantId, {
      ...body.data,
      staffId: resolveReportTargetStaffId(session, body.data.staffId),
    });
    if (!result.ok) return apiError(c, 404, 'not_found', '顧客またはスタッフが見つかりません');
    return c.json({ success: true as const });
  });

  /** 顧客の活動記録(日報+事故報告)を新しい順に取得する。GAS版getCustomerReports。 */
  app.get('/history', requireSession(container, 'report.history.view'), async (c) => {
    const session = c.get('session');
    const customerId = c.req.query('customerId');
    if (!customerId || !idSchema.safeParse(customerId).success) {
      return apiError(c, 400, 'validation_failed', 'customerId クエリパラメータが必要です');
    }
    const beforeParam = c.req.query('before');
    const before = beforeParam ? new Date(beforeParam) : null;
    if (before && Number.isNaN(before.getTime())) {
      return apiError(c, 400, 'validation_failed', 'before は有効なISO日時にしてください');
    }
    const items = await getCustomerHistory(container, session.tenantId, customerId, before, HISTORY_LIMIT);
    return c.json({ items });
  });

  return app;
}
