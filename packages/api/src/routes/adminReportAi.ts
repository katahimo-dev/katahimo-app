import { parseReportAiWorkbook, reportAiMastersToSheets } from '@katahimo/core/domain';
import type { ReportAiMasterRecords, ReportAiRowMeta, ReportAiRowTable } from '@katahimo/core/ports';
import {
  archiveReportAiRow,
  exportReportAiMasters,
  importReportAiMasters,
  listReportAiMasters,
  reportAiKeywordUsage,
  saveReportAiLevel,
  saveReportAiRow,
} from '@katahimo/core/usecases';
import {
  archiveReportAiRowRequestSchema,
  idSchema,
  okResponseSchema,
  REPORT_AI_USAGE_MAX_RANGE_DAYS,
  type ReportAiRowKind,
  reportAiImportRequestSchema,
  reportAiImportResponseSchema,
  reportAiMastersResponseSchema,
  reportAiRowSavedResponseSchema,
  reportAiUsageQuerySchema,
  saveReportAgeBandRequestSchema,
  saveReportEducationLevelRequestSchema,
  saveReportKeywordRequestSchema,
  saveReportPhraseRequestSchema,
  saveReportPsiLevelRequestSchema,
  saveReportStanceRuleRequestSchema,
} from '@katahimo/shared';
import { type Context, Hono } from 'hono';
import type { z } from 'zod';
import type { Container } from '../container';
import { buildReportAiWorkbook, readReportAiWorkbook } from '../export/reportAiWorkbook';
import { withXlsxReadSlot, XLSX_READ_BUSY_MESSAGE, XLSX_READ_BUSY_RETRY_MS } from '../export/xlsxSheets';
import { csvLine, UTF8_BOM } from '../http/csv';
import { attachmentDisposition, xlsxResponse } from '../http/download';
import { enforceStaffQuota } from '../http/quota';
import { apiError, jsonOk, parseJsonBody, parseQuery, rateLimited } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireAdmin } from '../session';

/** URL の :kind → 表と要求のスキーマ。 */
const ROW_KINDS: Record<ReportAiRowKind, { table: ReportAiRowTable; schema: z.ZodTypeAny }> = {
  keywords: { table: 'keywords', schema: saveReportKeywordRequestSchema },
  'age-bands': { table: 'ageBands', schema: saveReportAgeBandRequestSchema },
  phrases: { table: 'phrases', schema: saveReportPhraseRequestSchema },
  'stance-rules': { table: 'stanceRules', schema: saveReportStanceRuleRequestSchema },
};

const savedView = (meta: ReportAiRowMeta) => ({
  id: meta.id,
  rowVersion: meta.rowVersion,
  updatedAt: meta.updatedAt.toISOString(),
});

function mastersView(records: ReportAiMasterRecords) {
  const iso = <T extends { updatedAt: Date }>(rows: T[]) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  return {
    keywords: iso(records.keywords),
    ageBands: iso(records.ageBands),
    educationLevels: iso(records.educationLevels),
    psiLevels: iso(records.psiLevels),
    phrases: iso(records.phrases),
    stanceRules: iso(records.stanceRules),
  };
}

function rowKindOf(c: Context): (typeof ROW_KINDS)[ReportAiRowKind] | null {
  const kind = c.req.param('kind') as ReportAiRowKind;
  return Object.hasOwn(ROW_KINDS, kind) ? ROW_KINDS[kind] : null;
}

const levelOf = (c: Context) => {
  const level = Number(c.req.param('level'));
  return Number.isInteger(level) && level >= 1 && level <= 5 ? level : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 管理画面「日報AIの調整」(/api/admin/report-ai。管理者だけ)。お客様の日報キーワード表現マスター(年齢帯・
 * キーワード・教育思考★・PSI・表現・見ていた人スタンス)の一覧・行ごとの編集・xlsx の取込(先に確かめる)・
 * 書き出し・キーワードの利用状況の CSV。
 */
export function createAdminReportAiRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.get('/', requireAdmin(container, 'settings.report_ai.view'), async (c) =>
    jsonOk(c, reportAiMastersResponseSchema, mastersView(await listReportAiMasters(container, actorOf(c)))),
  );

  app.get('/export.xlsx', requireAdmin(container, 'settings.report_ai.export'), async (c) => {
    const records = await exportReportAiMasters(container, actorOf(c));
    const body = await buildReportAiWorkbook(reportAiMastersToSheets(records));
    return xlsxResponse(c, body, '日報キーワード表現マスター.xlsx', 'report-ai-masters.xlsx');
  });

  app.get('/usage.csv', requireAdmin(container, 'settings.report_ai.usage'), async (c) => {
    const query = parseQuery(c, reportAiUsageQuerySchema);
    if (!query.ok) return query.response;
    const days = (Date.parse(query.data.to) - Date.parse(query.data.from)) / DAY_MS + 1;
    if (days > REPORT_AI_USAGE_MAX_RANGE_DAYS) {
      return apiError(
        c,
        400,
        'validation_failed',
        `期間は${REPORT_AI_USAGE_MAX_RANGE_DAYS}日までにしてください`,
        {
          from: '期間が長すぎます',
        },
      );
    }
    const rows = await reportAiKeywordUsage(container, actorOf(c), query.data);
    const csv =
      UTF8_BOM +
      csvLine([
        'ID',
        'キーワード',
        'カテゴリ',
        '候補に出した回数',
        'AIが使った回数',
        '候補外でAIが使ったと答えた回数',
      ]) +
      rows
        .map((r) =>
          csvLine([
            r.code,
            r.keyword,
            r.category ?? '',
            String(r.candidateCount),
            String(r.usedCount),
            String(r.notOfferedCount),
          ]),
        )
        .join('');
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header(
      'Content-Disposition',
      attachmentDisposition(
        `日報キーワードの利用状況_${query.data.from}_${query.data.to}.csv`,
        `report-ai-usage_${query.data.from}_${query.data.to}.csv`,
      ),
    );
    c.header('Cache-Control', 'no-store');
    return c.body(csv);
  });

  app.post('/import', requireAdmin(container, 'settings.report_ai.import'), async (c) => {
    const body = await parseJsonBody(c, reportAiImportRequestSchema);
    if (!body.ok) return body.response;
    // 確かめる(dryRun)・反映の両方を数える(どちらも xlsx を展開して読むため)。読む前に数える
    const limited = await enforceStaffQuota(
      c,
      container,
      container.rateLimits.reportAiXlsxImportStaff,
      '日報AIの調整の取込の回数の上限に達しました。少し時間をおいてからもう一度お試しください。',
    );
    if (limited) return limited;
    // exceljs で読むのはこのインスタンスで1つずつ(メモリを使うため。xlsxSheets.ts の withXlsxReadSlot)
    const read = await withXlsxReadSlot(() =>
      readReportAiWorkbook(Buffer.from(body.data.fileBase64, 'base64')),
    );
    if (!read.ok) return rateLimited(c, XLSX_READ_BUSY_RETRY_MS, XLSX_READ_BUSY_MESSAGE);
    const sheets = read.value;
    const result = await importReportAiMasters(container, actorOf(c), {
      parsed: parseReportAiWorkbook(sheets),
      dryRun: body.data.dryRun,
      fileName: body.data.fileName ?? null,
    });
    return jsonOk(c, reportAiImportResponseSchema, result);
  });

  app.put('/education-levels/:level', requireAdmin(container, 'settings.report_ai.save'), async (c) => {
    const level = levelOf(c);
    if (level === null) return apiError(c, 404, 'not_found', '段階が見つかりません');
    const body = await parseJsonBody(c, saveReportEducationLevelRequestSchema);
    if (!body.ok) return body.response;
    const saved = await saveReportAiLevel(
      container,
      actorOf(c),
      'educationLevels',
      { ...body.data.row, level },
      body.data.rowVersion,
    );
    return jsonOk(c, reportAiRowSavedResponseSchema, savedView(saved));
  });

  app.put('/psi-levels/:level', requireAdmin(container, 'settings.report_ai.save'), async (c) => {
    const level = levelOf(c);
    if (level === null) return apiError(c, 404, 'not_found', '段階が見つかりません');
    const body = await parseJsonBody(c, saveReportPsiLevelRequestSchema);
    if (!body.ok) return body.response;
    const saved = await saveReportAiLevel(
      container,
      actorOf(c),
      'psiLevels',
      { ...body.data.row, level },
      body.data.rowVersion,
    );
    return jsonOk(c, reportAiRowSavedResponseSchema, savedView(saved));
  });

  app.post('/:kind', requireAdmin(container, 'settings.report_ai.save'), async (c) => {
    const kind = rowKindOf(c);
    if (!kind) return apiError(c, 404, 'not_found', '表が見つかりません');
    const body = await parseJsonBody(c, kind.schema);
    if (!body.ok) return body.response;
    const saved = await saveReportAiRow(container, actorOf(c), kind.table, null, body.data.row);
    return jsonOk(c, reportAiRowSavedResponseSchema, savedView(saved), 201);
  });

  app.put('/:kind/:id', requireAdmin(container, 'settings.report_ai.save'), async (c) => {
    const kind = rowKindOf(c);
    const id = idSchema.safeParse(c.req.param('id'));
    if (!kind || !id.success) return apiError(c, 404, 'not_found', '行が見つかりません');
    const body = await parseJsonBody(c, kind.schema);
    if (!body.ok) return body.response;
    const saved = await saveReportAiRow(
      container,
      actorOf(c),
      kind.table,
      id.data,
      body.data.row,
      body.data.rowVersion,
    );
    return jsonOk(c, reportAiRowSavedResponseSchema, savedView(saved));
  });

  app.delete('/:kind/:id', requireAdmin(container, 'settings.report_ai.archive'), async (c) => {
    const kind = rowKindOf(c);
    const id = idSchema.safeParse(c.req.param('id'));
    if (!kind || !id.success) return apiError(c, 404, 'not_found', '行が見つかりません');
    const body = await parseJsonBody(c, archiveReportAiRowRequestSchema);
    if (!body.ok) return body.response;
    await archiveReportAiRow(container, actorOf(c), kind.table, id.data, body.data.rowVersion);
    return jsonOk(c, okResponseSchema, { ok: true });
  });

  return app;
}
