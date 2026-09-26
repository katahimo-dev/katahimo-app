import type { AuditLogFilters } from '../../api/admin';
import type { ReportListFilters } from '../../api/reports';

/** 管理画面の中だけで使うクエリキー。 */
export const adminQueryKeys = {
  staff: ['admin', 'staff'] as const,
  prompts: ['admin', 'prompts'] as const,
  /** 日報AIの調整のマスター。他の管理者の編集・取込で変わるので、開くたびに読み直す(staleTime 0)。 */
  reportAi: ['admin', 'report-ai'] as const,
  auditLogsAll: ['admin', 'audit-logs'] as const,
  auditLogs: (filters: AuditLogFilters) => ['admin', 'audit-logs', filters] as const,
  /** 報告一覧(日報・事故報告)。保存・書き直しで変わるので、開くたびに読み直す(staleTime 0)。 */
  reportsAll: ['admin', 'reports'] as const,
  reports: (filters: ReportListFilters) => ['admin', 'reports', 'list', filters] as const,
  reportDetail: (reportId: string) => ['admin', 'reports', 'detail', reportId] as const,
};
