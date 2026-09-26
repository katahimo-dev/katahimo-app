import type { AuditLogFilters } from '../../api/admin';

/** 管理画面の中だけで使うクエリキー。 */
export const adminQueryKeys = {
  staff: ['admin', 'staff'] as const,
  prompts: ['admin', 'prompts'] as const,
  auditLogsAll: ['admin', 'audit-logs'] as const,
  auditLogs: (filters: AuditLogFilters) => ['admin', 'audit-logs', filters] as const,
};
