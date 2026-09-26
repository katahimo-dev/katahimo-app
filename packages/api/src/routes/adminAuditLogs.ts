import type { AuditLogEntryView } from '@katahimo/core/usecases';
import { exportAuditLogs, listAuditLogs } from '@katahimo/core/usecases';
import {
  ACTOR_TYPE_LABELS,
  APP_LOG_LEVEL_LABELS,
  auditActionLabel,
  auditLogListResponseSchema,
  auditLogQuerySchema,
  formatAuditDetails,
  formatZonedDateTime,
} from '@katahimo/shared';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { Container } from '../container';
import { type CsvSink, csvLine, writeCsvStream } from '../http/csv';
import { requestIdOf } from '../http/requestLog';
import { jsonOk, parseQuery } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireAdmin } from '../session';

const CSV_HEADER = [
  '日時',
  'レベル',
  '操作',
  '操作コード',
  '操作者の種類',
  '操作者',
  '対象スタッフ',
  '詳細',
  'IPアドレス',
  'ユーザーエージェント',
  'リクエストID',
];

const DELETED_STAFF = '(削除されたスタッフ)';

function csvRow(entry: AuditLogEntryView, timeZone: string): string {
  return csvLine([
    formatZonedDateTime(entry.createdAt, timeZone),
    APP_LOG_LEVEL_LABELS[entry.level],
    auditActionLabel(entry.action),
    entry.action,
    ACTOR_TYPE_LABELS[entry.actorType],
    entry.actorStaffId ? (entry.actorName ?? DELETED_STAFF) : '',
    entry.targetStaffId ? (entry.targetName ?? DELETED_STAFF) : '',
    formatAuditDetails(entry.details),
    entry.ip ?? '',
    entry.userAgent ?? '',
    entry.requestId ?? '',
  ]);
}

/** 操作ログの CSV を書く(BOM・見出し・500件ずつの行。失敗・切断の扱いは writeCsvStream)。 */
export function writeAuditLogCsv(
  out: CsvSink,
  batches: AsyncIterable<AuditLogEntryView[]>,
  timeZone: string,
  requestId: string | null,
): Promise<void> {
  return writeCsvStream(out, {
    header: CSV_HEADER,
    batches,
    toLine: (entry) => csvRow(entry, timeZone),
    requestId,
    failureMessage: '操作ログの CSV の書き出しが途中で失敗しました',
  });
}

/**
 * 管理者の操作ログの閲覧(GET /api/admin/audit-logs)と CSV ダウンロード(GET /api/admin/audit-logs.csv。
 * GAS版の Drive の CSV ログの置き換え)。テナントのログだけを読む(tenantId はセッションから)。
 */
export function createAdminAuditLogRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.get('/audit-logs', requireAdmin(container, 'audit_log.view'), async (c) => {
    const query = parseQuery(c, auditLogQuerySchema);
    if (!query.ok) return query.response;
    return jsonOk(c, auditLogListResponseSchema, await listAuditLogs(container, actorOf(c), query.data));
  });

  app.get('/audit-logs.csv', requireAdmin(container, 'audit_log.export'), async (c) => {
    const query = parseQuery(c, auditLogQuerySchema);
    if (!query.ok) return query.response;
    const { cursor: _cursor, limit: _limit, ...criteria } = query.data;
    const exported = await exportAuditLogs(container, actorOf(c), criteria);
    const { from, to, timeZone } = exported.range;
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="audit-logs_${from}_${to}.csv"`);
    c.header('Cache-Control', 'no-store');
    const requestId = requestIdOf(c);
    return stream(c, (out) => writeAuditLogCsv(out, exported.entries(), timeZone, requestId));
  });

  return app;
}
