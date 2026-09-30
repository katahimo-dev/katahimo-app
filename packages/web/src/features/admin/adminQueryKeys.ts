import type { AuditLogFilters } from '../../api/admin';
import { queryKeys } from '../../api/queryKeys';
import type { ReportListFilters } from '../../api/reports';

/** 管理画面の中だけで使うクエリキー。 */
export const adminQueryKeys = {
  staff: ['admin', 'staff'] as const,
  prompts: ['admin', 'prompts'] as const,
  /** 日報AIの調整のマスター。他の管理者の編集・取込で変わるので、開くたびに読み直す(staleTime 0)。 */
  reportAi: ['admin', 'report-ai'] as const,
  auditLogsAll: ['admin', 'audit-logs'] as const,
  auditLogs: (filters: AuditLogFilters) => ['admin', 'audit-logs', filters] as const,
  /** 報告一覧(日報・事故報告)。日報の画面で保存したら `queryKeys.reports.all` ごと読み直す(useReportController)。 */
  reportsAll: queryKeys.reports.all,
  reports: (filters: ReportListFilters) => [...queryKeys.reports.all, 'admin-list', filters] as const,
  reportDetail: (reportId: string) => [...queryKeys.reports.all, 'detail', reportId] as const,
};
