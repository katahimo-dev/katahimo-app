import { normalizeStaffName } from '@katahimo/core/domain';
import type { LegacySheet, LegacySheetCell } from '@katahimo/core/ports';
import type {
  LegacyAccidentReportRow,
  LegacyDailyReportRow,
  LegacyRowIssue,
  LegacySheetRows,
} from '@katahimo/core/usecases';
import {
  cellAt,
  cellId,
  cellRating,
  cellText,
  cellTimeOfDay,
  cellTrimmed,
  cellWallClock,
  isBlankRow,
} from './cells';

/**
 * GAS版の「日報」シートの列(0始まり)。Main.js saveReport と Bridge.js bridgeWriteDailyReport_ が書く並び
 * (Timestamp, StartTime, EndTime, User, CustomerId, CustomerName, InputText, InternalReport, CustomerReport,
 * RiskRating, EsRating, KatahimoReportId)。
 */
const DAILY_COLUMNS = {
  timestamp: 0,
  startTime: 1,
  endTime: 2,
  staffName: 3,
  customerId: 4,
  inputText: 6,
  internalText: 7,
  customerText: 8,
  riskRating: 9,
  esRating: 10,
  katahimoReportId: 11,
} as const;

/**
 * GAS版の「事故報告」シートの列(0始まり)。Main.js saveAccidentReport と Bridge.js bridgeWriteAccidentReport_ が書く
 * 16列(+KatahimoReportId)。GAS版が最初に作った見出しの行には TargetName・TargetDob が無いが、行の値は常にこの並び
 * (getCustomerReports も位置で読む)。
 */
const ACCIDENT_COLUMNS = {
  timestamp: 0,
  staffName: 1,
  customerId: 2,
  targetName: 4,
  targetDob: 5,
  occurrenceTime: 6,
  location: 7,
  accidentContent: 8,
  situation: 9,
  immediateResponse: 10,
  parentCorrespondence: 11,
  diagnosisTreatment: 12,
  prevention: 13,
  inputText: 14,
  reportType: 15,
  katahimoReportId: 16,
} as const;

/** 1行目の最初のセルが GAS版の見出し('Timestamp')か確かめる(別のシートを読み違えない)。 */
function assertHeader(sheet: LegacySheet, label: string): void {
  const first = sheet.rows[0];
  if (!first) return;
  if (cellTrimmed(cellAt(first, 0)) !== 'Timestamp') {
    throw new Error(`「${sheet.title}」の1行目が GAS版の${label}シートの見出し(Timestamp …)ではありません`);
  }
}

/**
 * 行を指すキー(日時・担当・顧客ID(・開始時刻))。GAS版の上書き保存(同じ行の書き換え)で変わらない列だけから作り、
 * 行番号・本文は入れない。同じキーの行が複数ある(同じ訪問の日報を2回新しく保存した)ときは、上から2つ目以降に
 * '#2' '#3' … を付ける(GAS版は行を消さず末尾に足すだけのため、順番は変わらない)。
 */
class SourceKeys {
  private readonly seen = new Map<string, number>();

  next(parts: readonly string[]): string {
    const base = JSON.stringify(parts);
    const n = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  }
}

interface CommonCells {
  rowNumber: number;
  timestamp: string;
  staffName: string;
  customerExternalId: string;
}

/** 見出しの次の行から読み、空の行・本アプリからのミラーの行・日時の読めない行を除く。 */
function readRows<T>(
  sheet: LegacySheet,
  source: LegacyRowIssue['source'],
  columns: { timestamp: number; staffName: number; customerId: number; katahimoReportId: number },
  toRow: (cells: readonly LegacySheetCell[], common: CommonCells, issues: LegacyRowIssue[]) => T,
): LegacySheetRows<T> {
  const result: LegacySheetRows<T> = { rows: [], issues: [], blankRowCount: 0 };
  sheet.rows.forEach((cells, index) => {
    if (index === 0) return;
    const rowNumber = index + 1;
    if (isBlankRow(cells)) {
      result.blankRowCount++;
      return;
    }
    if (cellTrimmed(cellAt(cells, columns.katahimoReportId))) {
      result.issues.push({ source, rowNumber, reason: 'from_app' });
      return;
    }
    const timestamp = cellWallClock(cellAt(cells, columns.timestamp));
    if (!timestamp) {
      result.issues.push({ source, rowNumber, reason: 'invalid_timestamp' });
      return;
    }
    const common: CommonCells = {
      rowNumber,
      timestamp,
      staffName: cellTrimmed(cellAt(cells, columns.staffName)),
      customerExternalId: cellId(cellAt(cells, columns.customerId)),
    };
    result.rows.push(toRow(cells, common, result.issues));
  });
  return result;
}

/** GAS版の「日報」シートを読む。 */
export function parseDailyReportSheet(sheet: LegacySheet): LegacySheetRows<LegacyDailyReportRow> {
  assertHeader(sheet, '日報');
  const keys = new SourceKeys();
  const source = 'gas_daily_report';
  return readRows(sheet, source, DAILY_COLUMNS, (cells, common, issues) => {
    const time = (index: number) => {
      const value = cellTimeOfDay(cellAt(cells, index));
      if (value !== null) return value;
      issues.push({ source, rowNumber: common.rowNumber, reason: 'time_invalid' });
      return '';
    };
    const rating = (index: number) => {
      const value = cellRating(cellAt(cells, index));
      if (value !== 'invalid') return value;
      issues.push({ source, rowNumber: common.rowNumber, reason: 'rating_invalid' });
      return null;
    };
    const startTime = time(DAILY_COLUMNS.startTime);
    return {
      source,
      ...common,
      sourceKey: keys.next([
        common.timestamp,
        normalizeStaffName(common.staffName),
        common.customerExternalId,
        startTime,
      ]),
      content: {
        startTime,
        endTime: time(DAILY_COLUMNS.endTime),
        inputText: cellText(cellAt(cells, DAILY_COLUMNS.inputText)),
        internalText: cellText(cellAt(cells, DAILY_COLUMNS.internalText)),
        customerText: cellText(cellAt(cells, DAILY_COLUMNS.customerText)),
      },
      riskRating: rating(DAILY_COLUMNS.riskRating),
      esRating: rating(DAILY_COLUMNS.esRating),
    };
  });
}

/** GAS版の「事故報告」シート(事故報告・ヒヤリハット)を読む。 */
export function parseAccidentReportSheet(sheet: LegacySheet): LegacySheetRows<LegacyAccidentReportRow> {
  assertHeader(sheet, '事故報告');
  const keys = new SourceKeys();
  const source = 'gas_accident_report';
  return readRows(sheet, source, ACCIDENT_COLUMNS, (cells, common) => {
    const text = (index: number) => cellText(cellAt(cells, index));
    return {
      source,
      ...common,
      // 事故報告の日時は GAS版の保存の時刻(上書き保存でも変わる)。開始時刻の列は無い
      sourceKey: keys.next([
        common.timestamp,
        normalizeStaffName(common.staffName),
        common.customerExternalId,
      ]),
      reportType: cellTrimmed(cellAt(cells, ACCIDENT_COLUMNS.reportType)),
      content: {
        targetName: cellTrimmed(cellAt(cells, ACCIDENT_COLUMNS.targetName)),
        // 生年月日・発生日時は自由記述だが、スプレッドシートが日付に変えることがあるため表示の文字列で読む
        targetDob: cellTrimmed(cellAt(cells, ACCIDENT_COLUMNS.targetDob)),
        occurrenceTime: cellTrimmed(cellAt(cells, ACCIDENT_COLUMNS.occurrenceTime)),
        location: text(ACCIDENT_COLUMNS.location),
        accidentContent: text(ACCIDENT_COLUMNS.accidentContent),
        situation: text(ACCIDENT_COLUMNS.situation),
        immediateResponse: text(ACCIDENT_COLUMNS.immediateResponse),
        parentCorrespondence: text(ACCIDENT_COLUMNS.parentCorrespondence),
        diagnosisTreatment: text(ACCIDENT_COLUMNS.diagnosisTreatment),
        prevention: text(ACCIDENT_COLUMNS.prevention),
        inputText: text(ACCIDENT_COLUMNS.inputText),
      },
    };
  });
}
