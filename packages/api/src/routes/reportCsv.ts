import type { ReportExportRow } from '@katahimo/core/usecases';
import {
  ACCIDENT_FIELD_LABELS,
  DAILY_FIELD_LABELS,
  REPORT_KIND_LABELS,
  type ReportCsvSheet,
} from '@katahimo/shared';
import { type CsvSink, csvLine, writeCsvStream } from '../http/csv';

const DELETED_STAFF = '(削除されたスタッフ)';
const UNKNOWN_CUSTOMER = '(不明なお客様)';
const rating = (value: number | null) => (value === null ? '' : String(value));

/**
 * 「日報」シート(GAS版 Main.js saveReport・Bridge.js writeDailyReport)と同じ並びの12列
 * (Timestamp, StartTime, EndTime, User, CustomerId, CustomerName, InputText, InternalReport, CustomerReport,
 * RiskRating, EsRating, KatahimoReportId)+ 最終更新。
 */
const DAILY_HEADER = [
  '日時',
  DAILY_FIELD_LABELS.startTime,
  DAILY_FIELD_LABELS.endTime,
  'スタッフ',
  '顧客ID',
  'お客様',
  DAILY_FIELD_LABELS.inputText,
  DAILY_FIELD_LABELS.internalText,
  DAILY_FIELD_LABELS.customerText,
  'PSI',
  'ES',
  '記録ID',
  '最終更新',
];

/**
 * 「事故報告」シート(GAS版 Main.js saveAccidentReport・Bridge.js writeAccidentReport)と同じ並びの17列
 * (Timestamp, Reporter, CustomerId, CustomerName, TargetName, TargetDob, OccurrenceTime, Location, AccidentContent,
 * Situation, ImmediateResponse, ParentCorrespondence, DiagnosisTreatment, Prevention, OriginalInput, ReportType,
 * KatahimoReportId)+ 最終更新。
 */
const ACCIDENT_HEADER = [
  '日時',
  '報告者',
  '顧客ID',
  'お客様',
  ACCIDENT_FIELD_LABELS.targetName,
  ACCIDENT_FIELD_LABELS.targetDob,
  ACCIDENT_FIELD_LABELS.occurrenceTime,
  ACCIDENT_FIELD_LABELS.location,
  ACCIDENT_FIELD_LABELS.accidentContent,
  ACCIDENT_FIELD_LABELS.situation,
  ACCIDENT_FIELD_LABELS.immediateResponse,
  ACCIDENT_FIELD_LABELS.parentCorrespondence,
  ACCIDENT_FIELD_LABELS.diagnosisTreatment,
  ACCIDENT_FIELD_LABELS.prevention,
  ACCIDENT_FIELD_LABELS.inputText,
  '種別',
  '記録ID',
  '最終更新',
];

export const REPORT_CSV_HEADERS: Record<ReportCsvSheet, readonly string[]> = {
  daily: DAILY_HEADER,
  accident: ACCIDENT_HEADER,
};

function reportCsvRow(row: ReportExportRow): string {
  const staff = row.staffName ?? DELETED_STAFF;
  const customer = row.customerName ?? UNKNOWN_CUSTOMER;
  if (row.kind === 'daily_report') {
    const c = row.content;
    return csvLine([
      row.timestamp,
      c.startTime,
      c.endTime,
      staff,
      row.customerExternalId,
      customer,
      c.inputText,
      c.internalText,
      c.customerText,
      rating(row.riskRating),
      rating(row.esRating),
      row.id,
      row.updatedTimestamp,
    ]);
  }
  const c = row.content;
  return csvLine([
    row.timestamp,
    staff,
    row.customerExternalId,
    customer,
    c.targetName,
    c.targetDob,
    c.occurrenceTime,
    c.location,
    c.accidentContent,
    c.situation,
    c.immediateResponse,
    c.parentCorrespondence,
    c.diagnosisTreatment,
    c.prevention,
    c.inputText,
    REPORT_KIND_LABELS[row.kind],
    row.id,
    row.updatedTimestamp,
  ]);
}

/** 日報・事故報告の CSV を書く(BOM・シートと同じ並びの見出し・500件ずつの行。失敗・切断の扱いは writeCsvStream)。 */
export function writeReportCsv(
  out: CsvSink,
  sheet: ReportCsvSheet,
  batches: AsyncIterable<ReportExportRow[]>,
  requestId: string | null,
): Promise<void> {
  return writeCsvStream(out, {
    header: REPORT_CSV_HEADERS[sheet],
    batches,
    toLine: reportCsvRow,
    requestId,
    failureMessage: '日報・事故報告の CSV の書き出しが途中で失敗しました',
  });
}
