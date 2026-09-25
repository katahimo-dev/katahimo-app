import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { GAS_APP_DIR } from './paths';

/**
 * GAS版のサーバー側コードのうち、スプレッドシート等に触れない純粋な関数をそのまま読み込んで使う
 * (出勤簿の週間予定の組み立て・日ごとの集計・月合計など)。モックの応答をGAS版と同じ計算で
 * 作るため、計算を書き写さずにGAS版のコードを vm で動かす。
 *
 * GASのグローバル(SpreadsheetApp 等)は読み込み時には使われないため、ほぼ空の環境で読める。
 */
export type RowData = Record<string, string | number>;

export interface GasPureFunctions {
  buildScheduleEventsFromRowData_: (dateStr: string, rowData: RowData) => unknown[];
  computeDayDerived: (rowData: RowData) => Record<string, number | string | null>;
  computeMonthlyTotals: (
    days: { rowData: RowData; derived: Record<string, unknown> }[],
  ) => Record<string, number>;
  PAST_SCHEDULE_INPUT_COLUMNS: Record<string, { type: string; label: string }>;
}

let cached: GasPureFunctions | null = null;

export function loadGasPureFunctions(): GasPureFunctions {
  if (cached) return cached;
  const context = vm.createContext({ console });
  for (const file of ['Config.js', 'AttendanceCalc.js', 'PastSchedule.js']) {
    vm.runInContext(readFileSync(resolve(GAS_APP_DIR, file), 'utf8'), context, { filename: file });
  }
  // const で宣言されたトップレベルの値はグローバルのプロパティにならないため、式で取り出す
  const pick = (expr: string) => vm.runInContext(expr, context);
  cached = {
    buildScheduleEventsFromRowData_: pick('buildScheduleEventsFromRowData_'),
    computeDayDerived: pick('computeDayDerived'),
    computeMonthlyTotals: pick('computeMonthlyTotals'),
    PAST_SCHEDULE_INPUT_COLUMNS: pick('PAST_SCHEDULE_INPUT_COLUMNS'),
  };
  return cached;
}
