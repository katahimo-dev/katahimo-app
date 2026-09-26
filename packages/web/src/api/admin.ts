import {
  type AuditLogQuery,
  adminStaffListResponseSchema,
  adminStaffResponseSchema,
  aiPromptListResponseSchema,
  auditLogListResponseSchema,
  type CreateStaffRequest,
  okResponseSchema,
  type UpdateAiPromptsRequest,
  type UpdateStaffRequest,
} from '@katahimo/shared';
import { api } from './client';

/** 条件のうち値のあるものだけのクエリ文字列(CSV のダウンロードのリンク用)。 */
function queryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

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
  /** CSV のダウンロード先(同じオリジンの Cookie でそのまま開ける)。 */
  csvUrl: (filters: AuditLogFilters) => `/api/admin/audit-logs.csv${queryString(filters)}`,
};
