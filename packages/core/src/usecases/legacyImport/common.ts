import { createHash } from 'node:crypto';
import { isDomainError, normalizeStaffName } from '../../domain';
import type { LegacyImportRowSource } from '../../domain/model';
import type { AppLogPort } from '../../ports/appLog';
import type { TenantRepositories, UnitOfWorkPort } from '../../ports/unitOfWork';
import { issueLevelOf, type LegacyRowIssue, type LegacyRowIssueReason } from './types';

export interface LegacyImportDeps {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

export interface LegacyImportOptions {
  /** true なら何も書かない(件数と行ごとの結果だけを返す)。 */
  dryRun?: boolean;
}

/** 1つの出どころ(シート)の件数。 */
export interface LegacyImportCounts {
  /** 新しく作った(dry-run では作る)記録。 */
  created: number;
  /** シートで直された行を記録に写した。 */
  updated: number;
  /** 取込済みで変わっていない。 */
  unchanged: number;
  /** 本アプリからのミラーの行(KatahimoReportId / KatahimoReceiptId のある行)。取り込まない。 */
  fromApp: number;
  /** 取り込まなかった(確定済み・取込の後に本アプリで直された・重複)。 */
  skipped: number;
  /** 取り込めなかった行(誤り)。 */
  errors: number;
  /** 取り込んだが一部の値を読めなかった・シートと違う行。 */
  warnings: number;
  /** 全てのセルが空の行。 */
  blank: number;
  /** 取込済みの記録のうち、今回のシートに行が無かったもの(シートで行を消した・日時等を直した)。 */
  missingFromSheet: number;
  /** 取込の対象の月の外の行(領収書だけ)。 */
  outOfRange: number;
}

export const emptyCounts = (): LegacyImportCounts => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  fromApp: 0,
  skipped: 0,
  errors: 0,
  warnings: 0,
  blank: 0,
  missingFromSheet: 0,
  outOfRange: 0,
});

/** 出どころ(シート)ごとの件数。 */
export type LegacyImportCountsBySource = Partial<Record<LegacyImportRowSource, LegacyImportCounts>>;

/** 行ごとの結果を残し、その段階の件数を数える。 */
export class IssueLog {
  readonly issues: LegacyRowIssue[] = [];

  constructor(private readonly counts: LegacyImportCountsBySource) {}

  add(source: LegacyImportRowSource, rowNumber: number, reason: LegacyRowIssueReason): void {
    this.issues.push({ source, rowNumber, reason });
    const counts = this.counts[source];
    if (!counts) return;
    if (reason === 'from_app') counts.fromApp++;
    else if (issueLevelOf(reason) === 'error') counts.errors++;
    else if (issueLevelOf(reason) === 'skipped') counts.skipped++;
    else counts.warnings++;
  }
}

/** import_runs.counts(出どころごとの件数を1段の JSON にする)。 */
export function flattenCounts(counts: LegacyImportCountsBySource): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [source, c] of Object.entries(counts)) {
    for (const [name, value] of Object.entries(c)) flat[`${source}.${name}`] = value;
  }
  return flat;
}

/** 行ごとの結果を出どころ・行番号の順に並べる。 */
export function sortIssues(issues: readonly LegacyRowIssue[]): LegacyRowIssue[] {
  return [...issues].sort((a, b) =>
    a.source === b.source ? a.rowNumber - b.rowNumber : a.source < b.source ? -1 : 1,
  );
}

/** 取込の実行を失敗で閉じ、ERROR のログを残す(行の値は残さない)。 */
export async function finishFailed(
  deps: LegacyImportDeps,
  tenantId: string,
  run: {
    id: string;
    dryRun: boolean;
    action: 'legacy_import.reports.failed' | 'legacy_import.receipts.failed';
    counts: LegacyImportCountsBySource;
  },
  error: unknown,
): Promise<void> {
  const reason = isDomainError(error) ? (error.reason ?? error.code) : 'unexpected';
  if (!run.dryRun) {
    await deps.uow
      .run(tenantId, (r) =>
        r.importRuns.finish(run.id, {
          status: 'failed',
          counts: flattenCounts(run.counts),
          message: '取込の途中で失敗しました。原因を直してから流し直してください(書き終えた分は残ります)。',
        }),
      )
      .catch(() => undefined);
  }
  await deps.appLog.write({
    tenantId,
    level: 'ERROR',
    action: run.action,
    actorType: 'system',
    details: {
      runId: run.dryRun ? null : run.id,
      dryRun: run.dryRun,
      error: reason,
      counts: flattenCounts(run.counts),
    },
  });
}

/** スタッフの氏名(空白の入り方の違いは無視する。normalizeStaffName)→ スタッフ。退職したスタッフも含む。 */
export type StaffByName = Map<string, string[]>;

export async function loadStaffByName(r: TenantRepositories): Promise<StaffByName> {
  const byName: StaffByName = new Map();
  for (const staff of await r.staff.listAll()) {
    const key = normalizeStaffName(staff.displayName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), staff.id]);
  }
  return byName;
}

export function resolveStaff(
  byName: StaffByName,
  staffName: string,
): { staffId: string } | { reason: LegacyRowIssueReason } {
  const key = normalizeStaffName(staffName);
  if (!key) return { reason: 'staff_missing' };
  const ids = byName.get(key) ?? [];
  if (ids.length === 0) return { reason: 'staff_not_found' };
  if (ids.length > 1) return { reason: 'staff_ambiguous' };
  return { staffId: ids[0] as string };
}

/** 行の内容(記録にする値)の SHA-256。 */
export function sourceDigestOf(value: unknown): Uint8Array {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest();
}

export const sameDigest = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** 配列を size 件ずつに分ける。 */
export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
