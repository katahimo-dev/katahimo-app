import type { ReportCsvSheet, ReportKind } from '@katahimo/shared';

/** 種類の帯の色(これまでの記録と同じ: 日報=青、事故報告=赤、ヒヤリハット=橙)。 */
export const REPORT_KIND_BADGE: Record<ReportKind, string> = {
  daily_report: 'bg-blue-500',
  accident: 'bg-red-500',
  near_miss: 'bg-orange-400',
};

export const DELETED_STAFF = '(削除されたスタッフ)';
export const UNKNOWN_CUSTOMER = '(不明なお客様)';

/** 種類の絞り込みに合う CSV の形(日報だけなら日報のシート、事故報告・ヒヤリハットなら事故報告のシート)。 */
export function csvSheetsFor(kind: ReportKind | undefined): ReportCsvSheet[] {
  if (!kind) return ['daily', 'accident'];
  return kind === 'daily_report' ? ['daily'] : ['accident'];
}
