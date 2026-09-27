import {
  issueLevelOf,
  LEGACY_ROW_ISSUE_LABELS,
  type LegacyImportCounts,
  type LegacyRowIssue,
} from '@katahimo/core/usecases';

/**
 * 移行の取込の結果の表示(件数と、行番号・理由のコードだけ。セルの値・氏名は出さない)。
 */

const SOURCE_LABELS: Record<LegacyRowIssue['source'], string> = {
  gas_daily_report: '日報',
  gas_accident_report: '事故報告',
  gas_receipt: '領収書',
};

const LEVEL_LABELS = { error: '誤り', skipped: 'スキップ', warning: '注意' } as const;

export function formatCounts(
  source: LegacyRowIssue['source'],
  c: LegacyImportCounts,
  dryRun: boolean,
): string {
  const parts = [
    `${dryRun ? '作成する' : '作成'} ${c.created}`,
    `${dryRun ? '更新する' : '更新'} ${c.updated}`,
    `変更なし ${c.unchanged}`,
    `本アプリの行 ${c.fromApp}`,
    `スキップ ${c.skipped}`,
    `誤り ${c.errors}`,
    `注意 ${c.warnings}`,
    `空の行 ${c.blank}`,
  ];
  if (source === 'gas_receipt') parts.push(`対象の月の外 ${c.outOfRange}`);
  else parts.push(`シートに無い取込済み ${c.missingFromSheet}`);
  return `[import] ${SOURCE_LABELS[source]}: ${parts.join(' / ')}`;
}

/** 本アプリからのミラーの行は数だけ(行ごとには出さない)。 */
export function printIssues(issues: readonly LegacyRowIssue[]): void {
  for (const issue of issues) {
    if (issue.reason === 'from_app') continue;
    const level = issueLevelOf(issue.reason);
    const line = `[import] ${SOURCE_LABELS[issue.source]} ${issue.rowNumber}行目: ${LEVEL_LABELS[level]} ${LEGACY_ROW_ISSUE_LABELS[issue.reason]}(${issue.reason})`;
    if (level === 'error') console.error(line);
    else console.warn(line);
  }
}
