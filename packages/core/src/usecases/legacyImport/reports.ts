import { isDeepStrictEqual } from 'node:util';
import {
  addIsoDays,
  CARE_RECORD_BODY_SCHEMA_VERSION,
  isDomainError,
  legacyWallClockDate,
  legacyWallClockToInstant,
  newId,
  recordTypeOfAccidentReport,
  zonedBusinessDate,
} from '../../domain';
import type { CareRecordType, LegacyImportRowSource } from '../../domain/model';
import type { CareRecordContent } from '../../domain/reports/careRecord';
import type { InstantRangeValue } from '../../ports/attendance';
import type { LegacyImportedRow } from '../../ports/legacyImport';
import type { CareRecordRow } from '../../ports/records';
import type { TenantRepositories } from '../../ports/unitOfWork';
import { resolveReportCareRecipient } from '../reportCareRecipient';
import { servicePeriodOf } from '../reports';
import {
  chunksOf,
  emptyCounts,
  finishFailed,
  flattenCounts,
  IssueLog,
  type LegacyImportCounts,
  type LegacyImportCountsBySource,
  type LegacyImportDeps,
  type LegacyImportOptions,
  loadStaffByName,
  resolveStaff,
  type StaffByName,
  sameDigest,
  sortIssues,
  sourceDigestOf,
} from './common';
import type {
  LegacyAccidentReportRow,
  LegacyDailyReportRow,
  LegacyReportRow,
  LegacyRowIssue,
  LegacySheetRows,
} from './types';

export interface LegacyReportImportInput {
  /** 読んだスプレッドシートの ID(import_runs.file_name に残す)。 */
  spreadsheetId: string;
  daily: LegacySheetRows<LegacyDailyReportRow>;
  accident: LegacySheetRows<LegacyAccidentReportRow>;
}

export interface LegacyReportImportResult {
  dryRun: boolean;
  /** import_runs の ID(dry-run は null)。 */
  runId: string | null;
  counts: Record<'gas_daily_report' | 'gas_accident_report', LegacyImportCounts>;
  /** 行ごとの結果(出どころ・行番号の順)。 */
  issues: LegacyRowIssue[];
  /** 取込済みの記録のうち、今回のシートでその行番号が空・シートの外だったもの(シートで行を消した)。 */
  missingFromSheet: { source: LegacyImportRowSource; careRecordId: string }[];
}

/** 1つのトランザクションで書く行の数。 */
export const LEGACY_REPORT_BATCH_SIZE = 200;

interface ImportContext {
  runId: string;
  dryRun: boolean;
  timeZone: string;
  retentionDays: number;
  staffByName: StaffByName;
  customerByExternalId: Map<string, { customerId: string }>;
  counts: LegacyImportCountsBySource;
  log: IssueLog;
}

/** 行から作る記録の値(担当・顧客は上書きでは変えない。違えば別の行として row_conflict)。 */
interface PlannedRecord {
  recordType: CareRecordType;
  occurredAt: Date;
  servicePeriod: InstantRangeValue | null;
  riskRating: number | null;
  esRating: number | null;
  body: CareRecordContent;
}

function plannedRecordOf(row: LegacyReportRow, timeZone: string): PlannedRecord {
  const occurredAt = legacyWallClockToInstant(row.timestamp, timeZone);
  if (row.source === 'gas_daily_report') {
    return {
      recordType: 'daily_report',
      occurredAt,
      servicePeriod: servicePeriodOf(
        legacyWallClockDate(row.timestamp),
        row.content.startTime,
        row.content.endTime,
        timeZone,
      ),
      riskRating: row.riskRating,
      esRating: row.esRating,
      body: row.content,
    };
  }
  return {
    recordType: recordTypeOfAccidentReport(row.reportType),
    occurredAt,
    servicePeriod: null,
    riskRating: null,
    esRating: null,
    body: row.content,
  };
}

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined) => a?.getTime() === b?.getTime();

/** 記録が行から作る値と同じか(本文・評価・種類・日時・訪問の時間帯。本文は jsonb のためキーの順番は見ない)。 */
function sameAsPlanned(record: CareRecordRow, planned: PlannedRecord): boolean {
  return (
    record.recordType === planned.recordType &&
    record.riskRating === planned.riskRating &&
    record.esRating === planned.esRating &&
    isDeepStrictEqual(record.body, planned.body) &&
    sameInstant(record.occurredAt, planned.occurredAt) &&
    sameInstant(record.servicePeriod?.start, planned.servicePeriod?.start) &&
    sameInstant(record.servicePeriod?.end, planned.servicePeriod?.end)
  );
}

/**
 * GAS版の「日報」「事故報告」シートの行を care_records に取り込む(移行の取込。`pnpm import:legacy-reports`)。
 *
 * - 全ての行を取り込む。本アプリからのミラーの行(KatahimoReportId のある行)は読む側(ingestion)が除いている。
 * - 行はシートの行番号で legacy_imported_rows と突き合わせ、同じ行は2回作らない(何度流してもよい)。GAS版は行を
 *   末尾に足すか行番号で上書きするだけで、行を消さない・並べ替えないため、上書き保存で日時(事故報告は保存の時刻)・
 *   開始時刻が変わっても同じ記録を指す。取込済みの行は、行の内容のキーと SHA-256 が変わっていなければ何もしない。
 *   変わっていれば(GAS版で上書き保存された)、担当・顧客が同じなら記録の本文・評価・日時を直す(提出済みの記録なので、
 *   変更前の本文はトリガーが care_record_revisions に残す)。担当・顧客が違えば別の行に置き換わっている(row_conflict)。
 *   確定済み(locked)の記録と、取込の後に本アプリで直された記録(版が取込の書いた版と違う)は直さずに skipped にする。
 * - 行の内容のキー(日時・担当・顧客ID・開始時刻)は念のための確かめに使う: 取込済みの行の内容が別の行番号に
 *   動いている(シートの行を消した・並べ替えた)行は、動いた先・元の両方を取り込まない(row_moved)。
 * - 担当はスタッフの氏名(空白の違いは無視。退職したスタッフも含む)、顧客は RESERVA の顧客ID で探す。見つからない行は
 *   取り込まない(error)。記録には顧客が要る。
 * - 記録は提出済み(submitted)。日報の対象のお子様は、世帯のお子様が1人ならその子(画面で保存したときと同じ)。
 *   スプレッドシートへのミラー・Google Chat・Web Push の知らせは積まない(元がスプレッドシートのため)。
 * - LEGACY_REPORT_BATCH_SIZE 行ずつのトランザクションで書き、各トランザクションの最初にテナントの取込のロックを取る。
 *   途中で失敗しても、書き終えた分は残り、流し直せば続きから取り込む。
 */
export async function importLegacyReportRows(
  deps: LegacyImportDeps,
  tenantId: string,
  input: LegacyReportImportInput,
  options: LegacyImportOptions = {},
): Promise<LegacyReportImportResult> {
  const dryRun = options.dryRun === true;
  const runId = newId();
  const counts = { gas_daily_report: emptyCounts(), gas_accident_report: emptyCounts() };
  const log = new IssueLog(counts);
  if (!dryRun) {
    await deps.uow.run(tenantId, (r) =>
      r.importRuns.start({
        id: runId,
        source: 'legacy_reports_sheet',
        fileName: input.spreadsheetId,
        fileVersion: null,
        triggeredBy: null,
      }),
    );
  }
  const missingFromSheet: LegacyReportImportResult['missingFromSheet'] = [];
  try {
    const ctx: ImportContext = {
      runId,
      dryRun,
      counts,
      log,
      ...(await deps.uow.run(tenantId, async (r) => ({
        timeZone: (await r.tenant()).timezone,
        retentionDays: (await r.settings.get()).careRecordRetentionDays,
        staffByName: await loadStaffByName(r),
        customerByExternalId: await r.customerSourceRecords.mapExternalIds('reserva'),
      }))),
    };
    for (const sheet of [input.daily, input.accident] as LegacySheetRows<LegacyReportRow>[]) {
      for (const issue of sheet.issues) log.add(issue.source, issue.rowNumber, issue.reason);
    }
    counts.gas_daily_report.blank = input.daily.blankRowCount;
    counts.gas_accident_report.blank = input.accident.blankRowCount;

    for (const [source, sheet] of [
      ['gas_daily_report', input.daily],
      ['gas_accident_report', input.accident],
    ] as const) {
      const rows: LegacyReportRow[] = sheet.rows;
      const imported = await deps.uow.run(tenantId, (r) => r.legacyImports.listBySource(source));
      const moved = movedRowNumbersOf(rows, imported);
      for (const batch of chunksOf(rows, LEGACY_REPORT_BATCH_SIZE)) {
        await deps.uow.run(tenantId, async (r) => {
          if (!dryRun) await r.legacyImports.lockTenantLegacyImports();
          const links = new Map(
            (
              await r.legacyImports.findByRowNumbers(
                source,
                batch.map((row) => row.rowNumber),
              )
            ).map((link) => [link.rowNumber, link]),
          );
          for (const row of batch) {
            if (moved.has(row.rowNumber)) log.add(row.source, row.rowNumber, 'row_moved');
            else await importRow(r, ctx, row, links.get(row.rowNumber) ?? null);
          }
        });
      }
      // 取込済みの行番号が今のシートで空の行・シートの外(行を消した)
      const present = new Set([
        ...rows.map((row) => row.rowNumber),
        ...sheet.issues.filter((issue) => issue.source === source).map((issue) => issue.rowNumber),
      ]);
      for (const link of imported) {
        if (present.has(link.rowNumber) || !link.careRecordId) continue;
        missingFromSheet.push({ source, careRecordId: link.careRecordId });
        counts[source].missingFromSheet++;
      }
    }
  } catch (error) {
    await finishFailed(
      deps,
      tenantId,
      { id: runId, dryRun, action: 'legacy_import.reports.failed', counts },
      error,
    );
    throw error;
  }

  if (!dryRun) {
    await deps.uow.run(tenantId, (r) =>
      r.importRuns.finish(runId, { status: 'applied', counts: flattenCounts(counts), message: null }),
    );
    const hasProblems = Object.values(counts).some((c) => c.errors > 0 || c.missingFromSheet > 0);
    await deps.appLog.write({
      tenantId,
      level: hasProblems ? 'WARN' : 'INFO',
      action: 'legacy_import.reports.done',
      actorType: 'system',
      details: { runId, counts: flattenCounts(counts) },
    });
  }
  return {
    dryRun,
    runId: dryRun ? null : runId,
    counts,
    issues: sortIssues(log.issues),
    missingFromSheet,
  };
}

/**
 * 取込済みの行の内容が別の行番号に動いたと見られる行番号(動いた先と元の両方)。取込済みの行番号の今の行の内容のキーが
 * 取り込んだときと違い、取り込んだときのキーが別の行(その行番号で同じキーを取り込んでいない行)にあれば、行が動いた
 * (シートの行を消した・並べ替えた)とみる。キーが変わっただけ(日時・開始時刻を直した)なら、その行番号の記録を直す。
 */
export function movedRowNumbersOf(
  rows: readonly { rowNumber: number; sourceKey: string }[],
  imported: readonly { rowNumber: number; sourceKey: string }[],
): Set<number> {
  const keyAt = new Map(rows.map((row) => [row.rowNumber, row.sourceKey]));
  const importedKeyAt = new Map(imported.map((link) => [link.rowNumber, link.sourceKey]));
  const rowsByKey = new Map<string, number[]>();
  for (const row of rows)
    rowsByKey.set(row.sourceKey, [...(rowsByKey.get(row.sourceKey) ?? []), row.rowNumber]);
  const moved = new Set<number>();
  for (const link of imported) {
    if (keyAt.get(link.rowNumber) === link.sourceKey) continue;
    const elsewhere = (rowsByKey.get(link.sourceKey) ?? []).filter(
      (n) => n !== link.rowNumber && importedKeyAt.get(n) !== link.sourceKey,
    );
    if (elsewhere.length === 0) continue;
    moved.add(link.rowNumber);
    for (const n of elsewhere) moved.add(n);
  }
  return moved;
}

async function importRow(
  r: TenantRepositories,
  ctx: ImportContext,
  row: LegacyReportRow,
  link: LegacyImportedRow | null,
): Promise<void> {
  const counts = ctx.counts[row.source] as LegacyImportCounts;
  const staff = resolveStaff(ctx.staffByName, row.staffName);
  if ('reason' in staff) return ctx.log.add(row.source, row.rowNumber, staff.reason);
  if (!row.customerExternalId) return ctx.log.add(row.source, row.rowNumber, 'customer_missing');
  const customer = ctx.customerByExternalId.get(row.customerExternalId);
  if (!customer) return ctx.log.add(row.source, row.rowNumber, 'customer_not_found');

  const planned = plannedRecordOf(row, ctx.timeZone);
  const digest = sourceDigestOf({ ...planned, occurredAt: planned.occurredAt.toISOString() });

  if (!link) {
    if (!ctx.dryRun) {
      const recipient =
        planned.recordType === 'daily_report'
          ? await resolveReportCareRecipient(r, customer.customerId, undefined)
          : null;
      const saved = await r.careRecords.insert({
        id: newId(),
        recordType: planned.recordType,
        status: 'submitted',
        visitId: null,
        customerId: customer.customerId,
        careRecipientId: recipient?.id ?? null,
        authorStaffId: staff.staffId,
        occurredAt: planned.occurredAt,
        servicePeriod: planned.servicePeriod,
        riskRating: planned.riskRating,
        esRating: planned.esRating,
        body: planned.body,
        bodySchemaVer: CARE_RECORD_BODY_SCHEMA_VERSION,
        retainUntil: addIsoDays(zonedBusinessDate(planned.occurredAt, ctx.timeZone), ctx.retentionDays),
      });
      await r.legacyImports.save({
        source: row.source,
        rowNumber: row.rowNumber,
        sourceKey: row.sourceKey,
        careRecordId: saved.id,
        receiptId: null,
        sourceDigest: digest,
        syncedRowVersion: saved.rowVersion,
        importRunId: ctx.runId,
      });
    }
    counts.created++;
    return;
  }

  if (link.sourceKey === row.sourceKey && sameDigest(link.sourceDigest, digest)) {
    counts.unchanged++;
    return;
  }
  const record = link.careRecordId ? await r.careRecords.findById(link.careRecordId) : null;
  if (!record) return ctx.log.add(row.source, row.rowNumber, 'record_missing');
  // 同じ行番号に別の担当・顧客の行がある(行を消した・並べ替えた・書き換えた。GAS版はしない)
  if (record.authorStaffId !== staff.staffId || record.customerId !== customer.customerId) {
    return ctx.log.add(row.source, row.rowNumber, 'row_conflict');
  }
  if (record.status === 'locked') return ctx.log.add(row.source, row.rowNumber, 'locked');
  if (record.rowVersion !== link.syncedRowVersion) {
    return ctx.log.add(row.source, row.rowNumber, 'edited_in_app');
  }
  if (sameAsPlanned(record, planned)) {
    // 行の読み方だけが変わった(記録は同じ)。次から比べる内容を今の行にする
    if (!ctx.dryRun) {
      await r.legacyImports.save({
        ...link,
        sourceKey: row.sourceKey,
        sourceDigest: digest,
        importRunId: ctx.runId,
      });
    }
    counts.unchanged++;
    return;
  }
  if (!ctx.dryRun) {
    let saved: CareRecordRow;
    try {
      saved = await r.careRecords.update(
        record.id,
        {
          recordType: planned.recordType,
          occurredAt: planned.occurredAt,
          servicePeriod: planned.servicePeriod,
          riskRating: planned.riskRating,
          esRating: planned.esRating,
          body: planned.body,
          bodySchemaVer: CARE_RECORD_BODY_SCHEMA_VERSION,
        },
        link.syncedRowVersion,
      );
    } catch (error) {
      // 読んでから書くまでの間に本アプリで直された
      if (isDomainError(error) && error.code === 'conflict') {
        return ctx.log.add(row.source, row.rowNumber, 'edited_in_app');
      }
      throw error;
    }
    await r.legacyImports.save({
      ...link,
      sourceKey: row.sourceKey,
      sourceDigest: digest,
      syncedRowVersion: saved.rowVersion,
      importRunId: ctx.runId,
    });
  }
  counts.updated++;
}
