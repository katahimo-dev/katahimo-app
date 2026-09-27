import type { LegacySheet, LegacySheetCell } from '@katahimo/core/ports';

/**
 * テスト用のシート(Sheets API が返す形)。文字列・数値はそのまま値と表示に、null は空のセルにする。
 * 日時・時刻のセルは serial() でシリアル値と表示の文字列を作る。
 */
export type TestCell = LegacySheetCell | string | number | null;

export function testSheet(title: string, rows: TestCell[][]): LegacySheet {
  return {
    title,
    rows: rows.map((row) =>
      row.map((cell) =>
        cell === null
          ? { value: null, text: '' }
          : typeof cell === 'object'
            ? cell
            : { value: cell, text: String(cell) },
      ),
    ),
  };
}

/** 'yyyy/MM/dd HH:mm[:ss]' の壁時計時刻のシリアル値のセル(表示は GAS版のシートのように秒つき)。 */
export function serial(wallClock: string): LegacySheetCell {
  const [date = '', time = '00:00:00'] = wallClock.split(' ');
  const [y, mo, d] = date.split('/').map(Number) as [number, number, number];
  const [h = 0, mi = 0, s = 0] = time.split(':').map(Number);
  const days = (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return { value: days + (h * 3600 + mi * 60 + s) / 86_400, text: wallClock };
}

/** 時刻だけのシリアル値のセル('HH:mm')。 */
export function timeCell(hhmm: string): LegacySheetCell {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return { value: (h * 60 + m) / 1440, text: hhmm };
}

export const DAILY_HEADER = [
  'Timestamp',
  'StartTime',
  'EndTime',
  'User',
  'CustomerId',
  'CustomerName',
  'InputText',
  'InternalReport',
  'CustomerReport',
  'RiskRating',
  'EsRating',
  'KatahimoReportId',
];

/** GAS版が最初に作った見出し(TargetName・TargetDob が無い)。行の値は16列。 */
export const ACCIDENT_HEADER = [
  'Timestamp',
  'Reporter',
  'CustomerId',
  'CustomerName',
  'OccurrenceTime',
  'Location',
  'AccidentContent',
  'Situation',
  'ImmediateResponse',
  'ParentCorrespondence',
  'DiagnosisTreatment',
  'Prevention',
  'OriginalInput',
  'ReportType',
];

export const RECEIPT_HEADER = [
  '日時',
  'ユーザーID',
  '顧客ID',
  '顧客名',
  '金額',
  '名称',
  'Googleドライブ写真ファイルへのリンク',
  '申し送り',
  'KatahimoReceiptId',
];

export const driveLink = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`;
