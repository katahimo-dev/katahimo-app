import {
  type AuditLogQuery,
  adminStaffListResponseSchema,
  adminStaffResponseSchema,
  aiPromptListResponseSchema,
  archiveReportAiRowRequestSchema,
  auditLogListResponseSchema,
  type CreateStaffRequest,
  okResponseSchema,
  type ReportAiImportRequest,
  type ReportAiLevelKind,
  type ReportAiRowKind,
  type ReportAiUsageQuery,
  reportAiImportResponseSchema,
  reportAiMastersResponseSchema,
  reportAiRowSavedResponseSchema,
  type UpdateAiPromptsRequest,
  type UpdateStaffRequest,
  XLSX_CONTENT_TYPE,
} from '@katahimo/shared';
import { api } from './client';

/** 管理画面「スタッフ」(doc/04_API仕様.md スタッフ管理)。 */
export const adminStaffApi = {
  list: (signal?: AbortSignal) =>
    api.get('/api/admin/staff', adminStaffListResponseSchema, undefined, { signal }),
  create: (body: CreateStaffRequest) => api.post('/api/admin/staff', adminStaffResponseSchema, body),
  update: (staffId: string, body: UpdateStaffRequest) =>
    api.patch(`/api/admin/staff/${staffId}`, adminStaffResponseSchema, body),
  remove: (staffId: string) => api.delete(`/api/admin/staff/${staffId}`, okResponseSchema),
  sendPasswordGuide: (staffId: string) =>
    api.post(`/api/admin/staff/${staffId}/password-guide`, okResponseSchema),
};

/** 管理画面「AIプロンプト」。 */
export const aiPromptsApi = {
  list: (signal?: AbortSignal) =>
    api.get('/api/settings/admin/prompts', aiPromptListResponseSchema, undefined, { signal }),
  save: (body: UpdateAiPromptsRequest) =>
    api.put('/api/settings/admin/prompts', aiPromptListResponseSchema, body),
};

export type AuditLogFilters = Omit<AuditLogQuery, 'cursor' | 'limit'>;

/** 管理画面「操作ログ」。 */
export const auditLogsApi = {
  list: (filters: AuditLogFilters, cursor: string | undefined, signal?: AbortSignal) =>
    api.get(
      '/api/admin/audit-logs',
      auditLogListResponseSchema,
      { ...filters, cursor, limit: 50 },
      { signal },
    ),
  /** GET /api/admin/audit-logs.csv: 絞り込んだ条件の全件の CSV(断られたら理由つきのエラー。ファイルにしない) */
  downloadCsv: (filters: AuditLogFilters) =>
    api.download('/api/admin/audit-logs.csv', filters, 'text/csv', '操作ログ.csv'),
};

/** 管理画面「日報AIの調整」(日報キーワード表現マスター)。 */
export const reportAiApi = {
  masters: (signal?: AbortSignal) =>
    api.get('/api/admin/report-ai', reportAiMastersResponseSchema, undefined, { signal }),
  /** 行を足す(id が null)・書き換える(読んだときの版を送る。他の管理者が先に変えていれば 409)。 */
  saveRow: (kind: ReportAiRowKind, id: string | null, body: { row: unknown; rowVersion?: number }) =>
    id
      ? api.put(`/api/admin/report-ai/${kind}/${id}`, reportAiRowSavedResponseSchema, body)
      : api.post(`/api/admin/report-ai/${kind}`, reportAiRowSavedResponseSchema, body),
  /** ★・PSI の段階を書く(無ければ作る)。 */
  saveLevel: (kind: ReportAiLevelKind, level: number, body: { row: unknown; rowVersion?: number }) =>
    api.put(`/api/admin/report-ai/${kind}/${level}`, reportAiRowSavedResponseSchema, body),
  /** 行を外す(プロンプトに使わなくなる)。 */
  archiveRow: (kind: ReportAiRowKind, id: string, rowVersion: number) =>
    api.delete(
      `/api/admin/report-ai/${kind}/${id}`,
      okResponseSchema,
      archiveReportAiRowRequestSchema.parse({ rowVersion }),
    ),
  /** xlsx の取込(dryRun=true は確かめるだけ)。 */
  importXlsx: (body: ReportAiImportRequest) =>
    api.post('/api/admin/report-ai/import', reportAiImportResponseSchema, body),
  /** GET /api/admin/report-ai/export.xlsx: 取込と同じ形の xlsx。 */
  downloadXlsx: () =>
    api.download(
      '/api/admin/report-ai/export.xlsx',
      undefined,
      XLSX_CONTENT_TYPE,
      '日報キーワード表現マスター.xlsx',
    ),
  /** GET /api/admin/report-ai/usage.csv: 期間の教育キーワードの候補・使用の回数。 */
  downloadUsageCsv: (query: ReportAiUsageQuery) =>
    api.download('/api/admin/report-ai/usage.csv', query, 'text/csv', '日報キーワードの利用状況.csv'),
};
