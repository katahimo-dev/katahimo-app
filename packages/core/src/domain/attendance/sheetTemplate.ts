import type { AttendanceColumnKey } from '@katahimo/shared';
import { parseTimeToMinutes } from './attendanceCalc';
import { ATTENDANCE_COLUMNS, ATTENDANCE_SLOTS, VISIT_SLOTS } from './sheetLayout';
import type { AttendanceRowData } from './types';

/**
 * Excel に書き出す出勤簿(`GET /api/attendance/export`)の列の定義。
 *
 * お客様が今使っている「出勤簿テンプレート」(個別出勤簿 `<スタッフ名>_出勤簿_<年度>年度` の月のシートの元)と
 * 同じ列の並び(A〜AO)・同じ見出し・**同じ計算式**にする。入力の列(C・D・E・H・I…)は出勤簿の列記号
 * (rowData のキー)そのもので、sheetLayout.ts の ATTENDANCE_COLUMNS と一致する(sheetTemplate.test.ts が確かめる)。
 * 計算の列(F・G・J・K・O・P・S・T・AD・AE・AF・AK・AL・AM)はテンプレートの式をそのまま Excel の式として書き、
 * Excel が計算する(式の意味は attendanceCalc.ts と同じ。値が一致することも sheetTemplate.test.ts が確かめる)。
 * テンプレートに無い AP(働いた時間)・AQ(その日の領収書の金額)を右に足している。
 *
 * 列記号を書いてよいのは sheetLayout.ts(rowData の列)とこのファイル(書き出す表の列)だけ。
 */

/** セルの種類(書き出すときの値の形・表示の形式を決める)。 */
export type SheetCellKind =
  | 'date'
  | 'weekday'
  | 'text'
  | 'time'
  | 'number'
  | 'minutes'
  | 'minutesDecimal'
  | 'km'
  | 'count'
  | 'yen';

/**
 * 列の役割(見出しの色分け。テンプレートの凡例「修正可能」「手入力」に、計算式の列を加えたもの)。
 * calendar = カレンダーの予定から入る列(画面で直せる)、manual = 画面で手入力する列、formula = Excel の計算式。
 */
export type SheetColumnRole = 'date' | 'calendar' | 'manual' | 'formula';

/** 計算式が参照する、同じシートの中の範囲(領収書の明細の日付・金額の列)。 */
export interface SheetFormulaContext {
  receiptDateRange: string;
  receiptAmountRange: string;
}

export interface AttendanceSheetColumn {
  /** Excel の列記号。 */
  letter: string;
  header: string;
  kind: SheetCellKind;
  role: SheetColumnRole;
  /** 列の幅(文字数)。 */
  width: number;
  /** 入力の列: rowData のキー(列記号と同じ)。 */
  input?: AttendanceColumnKey;
  /** 計算の列: 行 row の式(先頭の '=' は付けない)。 */
  formula?: (row: number, context: SheetFormulaContext) => string;
  /** 合計の行に SUM を置く列。 */
  sumInTotals?: boolean;
}

// ─────────────────────────────────────────────────────────────
// テンプレートの式(行番号だけを差し替える)
// ─────────────────────────────────────────────────────────────

const CORE_START = 'TIME(10,0,0)';
const CORE_END = 'TIME(17,0,0)';

const isMtg = (title: string) => `OR(ISNUMBER(SEARCH("mtg", ${title})), ISNUMBER(SEARCH("MTG", ${title})))`;
const hasRange = (start: string, end: string) => `AND(COUNT(${start},${end})=2, ${end}>${start})`;
const coreOf = (start: string, end: string) =>
  `MAX(0, MIN(${end}, ${CORE_END}) - MAX(${start}, ${CORE_START}))`;

/** AD 労働時間数(所定内 10:00〜17:00 に重なった分。事務作業の内容に mtg を含めば全体)。 */
function laborFormula(row: number): string {
  const terms = ATTENDANCE_SLOTS.map((slot) => {
    const [title, start, end] = [slot.title, slot.start, slot.end].map((c) => `${c}${row}`) as [
      string,
      string,
      string,
    ];
    const core = coreOf(start, end);
    const body = slot.kind === 'office' ? `IF(${isMtg(title)}, MAX(0, ${end} - ${start}), ${core})` : core;
    return `IF(${hasRange(start, end)}, ${body}, 0)`;
  });
  return `ROUND((${terms.join(' + ')}) * 1440, 0)`;
}

/** AE 残業時間(所定外の分。事務作業の内容に mtg を含めば 0)。 */
function overtimeFormula(row: number): string {
  const terms = ATTENDANCE_SLOTS.map((slot) => {
    const [title, start, end] = [slot.title, slot.start, slot.end].map((c) => `${c}${row}`) as [
      string,
      string,
      string,
    ];
    const outside = `(${end} - ${start}) - ${coreOf(start, end)}`;
    const body = slot.kind === 'office' ? `IF(${isMtg(title)}, 0, ${outside})` : outside;
    return `IF(${hasRange(start, end)}, ${body}, 0)`;
  });
  return `ROUND((${terms.join(' + ')}) * 1440, 2)`;
}

const DISTANCE_COLUMNS = ['AG', 'AH', 'AI', 'AJ'] as const;

const input = (
  key: AttendanceColumnKey,
  header: string,
  role: 'calendar' | 'manual',
  width: number,
  kind?: SheetCellKind,
): AttendanceSheetColumn => {
  const columnKind = ATTENDANCE_COLUMNS[key].kind;
  const defaultKind: SheetCellKind =
    columnKind === 'time' ? 'time' : columnKind === 'number' ? 'number' : 'text';
  return { letter: key, header, role, width, input: key, kind: kind ?? defaultKind };
};

const formula = (
  letter: string,
  header: string,
  kind: SheetCellKind,
  width: number,
  build: (row: number, context: SheetFormulaContext) => string,
  sumInTotals = false,
): AttendanceSheetColumn => ({ letter, header, kind, role: 'formula', width, formula: build, sumInTotals });

const [slot1, slot2, slot3] = VISIT_SLOTS;

/**
 * 書き出す列(A〜AQ)。見出しはテンプレートの3行目と同じ(AP・AQ はテンプレートに無い列)。
 * 距離の入力の列は km、買物代行は回数。
 */
export const ATTENDANCE_SHEET_COLUMNS: readonly AttendanceSheetColumn[] = [
  { letter: 'A', header: '日', kind: 'date', role: 'date', width: 5 },
  { letter: 'B', header: '曜日', kind: 'weekday', role: 'date', width: 5 },
  input(slot1.title, '#1訪問先等', 'calendar', 14),
  input(slot1.start, '始業時刻', 'calendar', 7),
  input(slot1.end, '終業時刻', 'calendar', 7),
  formula('F', '移動開始時刻', 'time', 7, (r) => `E${r}`),
  formula('G', '移動終了時刻', 'time', 7, (r) => `F${r}+H${r}/1440`),
  input('H', '計画移動時間(分)', 'calendar', 8),
  input('I', '気象状況', 'manual', 7),
  formula('J', '移動時間', 'minutesDecimal', 7, (r) => `IF(I${r}="雪", H${r}*1.3, H${r})`),
  formula('K', '待機時間(分）', 'minutesDecimal', 7, (r) => `MAX(0,(M${r}-G${r})*1440)`),
  input(slot2.title, '#2訪問先等', 'calendar', 14),
  input(slot2.start, '始業時刻', 'calendar', 7),
  input(slot2.end, '終業時刻', 'calendar', 7),
  formula('O', '移動開始時刻', 'time', 7, (r) => `N${r}`),
  formula('P', '移動終了時刻', 'time', 7, (r) => `O${r}+Q${r}/1440`),
  input('Q', '計画移動時間(分)', 'calendar', 8),
  input('R', '気象状況', 'manual', 7),
  formula('S', '移動時間', 'minutesDecimal', 7, (r) => `IF(R${r}="雪", Q${r}*1.3, Q${r})`),
  formula('T', '待機時間(分）', 'minutesDecimal', 7, (r) => `MAX(0,(V${r}-P${r})*1440)`),
  input(slot3.title, '#3訪問先等', 'calendar', 14),
  input(slot3.start, '始業時刻', 'calendar', 7),
  input(slot3.end, '終業時刻', 'calendar', 7),
  input('X', '事務作業１', 'manual', 12),
  input('Y', '開始時刻', 'manual', 7),
  input('Z', '終了時刻', 'manual', 7),
  input('AA', '事務作業２', 'manual', 12),
  input('AB', '開始時刻', 'manual', 7),
  input('AC', '終了時刻', 'manual', 7),
  formula('AD', '労働時間数(分)\n所定内 10:00〜17:00', 'minutes', 11, laborFormula, true),
  formula('AE', '残業時間(分)\n所定外', 'minutesDecimal', 9, overtimeFormula, true),
  formula('AF', '移動時間(分)', 'minutesDecimal', 8, (r) => `J${r}+S${r}`, true),
  input('AG', '#1移動距離(km)', 'calendar', 8, 'km'),
  input('AH', '#2移動距離(km)', 'calendar', 8, 'km'),
  input('AI', '出勤距離(km)', 'calendar', 8, 'km'),
  input('AJ', '退勤距離(km)', 'calendar', 8, 'km'),
  formula('AK', '総移動距離(km)', 'km', 8, (r) => `SUM(AG${r}:AJ${r})`, true),
  formula(
    'AL',
    '基準距離超過回数',
    'count',
    8,
    (r) => DISTANCE_COLUMNS.map((c) => `INT(MAX(0, ${c}${r} - 15) / 5)`).join(' + '),
    true,
  ),
  formula(
    'AM',
    '訪問等回数*',
    'count',
    7,
    (r) =>
      `IF(ISNUMBER(AH${r}), 3, IF(ISNUMBER(AG${r}), 2, IF(OR(ISNUMBER(AI${r}), ISNUMBER(AJ${r})), 1, 0)))`,
    true,
  ),
  { ...input('AN', '買物代行', 'manual', 7), sumInTotals: true },
  input('AO', '備考', 'manual', 30),
  formula('AP', '働いた時間(分)\n所定内+残業', 'minutesDecimal', 10, (r) => `AD${r}+AE${r}`, true),
  formula(
    'AQ',
    '領収書(円)',
    'yen',
    9,
    (r, ctx) => `SUMIFS(${ctx.receiptAmountRange}, ${ctx.receiptDateRange}, A${r})`,
    true,
  ),
];

/** 列記号 → 列の定義。 */
export function sheetColumnOf(letter: string): AttendanceSheetColumn {
  const column = ATTENDANCE_SHEET_COLUMNS.find((c) => c.letter === letter);
  if (!column) throw new Error(`出勤簿の書き出しに無い列です: ${letter}`);
  return column;
}

/** 月の集計の欄に出す合計(合計の行の列を参照する)。 */
export const ATTENDANCE_SHEET_SUMMARY_ITEMS: readonly {
  label: string;
  letter: string;
  kind: SheetCellKind;
}[] = [
  { label: '働いた時間(分)', letter: 'AP', kind: 'minutesDecimal' },
  { label: 'うち 労働時間数(所定内・分)', letter: 'AD', kind: 'minutes' },
  { label: 'うち 残業時間(分)', letter: 'AE', kind: 'minutesDecimal' },
  { label: '移動時間(分)', letter: 'AF', kind: 'minutesDecimal' },
  { label: '総移動距離(km)', letter: 'AK', kind: 'km' },
  { label: '基準距離超過回数', letter: 'AL', kind: 'count' },
  { label: '訪問等回数', letter: 'AM', kind: 'count' },
  { label: '買物代行', letter: 'AN', kind: 'number' },
];

/** 表の行の位置(1始まり)。見出しは1〜3行目、4行目から1日1行(テンプレートと同じ)。 */
export const ATTENDANCE_SHEET_ROWS = {
  headerLabels: 1,
  headerValues: 2,
  columnHeaders: 3,
  firstDay: 4,
} as const;

/** 日の列・領収書の明細の日付の列(SUMIFS の突き合わせに使う)。 */
export const SHEET_DAY_COLUMN = 'A';

// ─────────────────────────────────────────────────────────────
// 入力の値(文字列の rowData → セルの値)
// ─────────────────────────────────────────────────────────────

/** 1日(24時間)を1とした Excel の時刻の値。'HH:mm' でなければ null。 */
export function excelTimeValue(hhmm: string): number | null {
  const minutes = parseTimeToMinutes(hhmm);
  return minutes === null ? null : minutes / 1440;
}

/**
 * 入力の列のセルの値。時刻は Excel の時刻の値(式で計算できるように)、数の列は数、それ以外は文字列。
 * 空は null(セルを空のままにする。テンプレートの式は空のセルを0として扱う)。形の合わない値は文字列のまま。
 */
export function sheetInputValue(
  column: AttendanceSheetColumn,
  rowData: AttendanceRowData,
): string | number | null {
  if (!column.input) return null;
  const raw = (rowData[column.input] ?? '').trim();
  if (raw === '') return null;
  if (column.kind === 'time') return excelTimeValue(raw) ?? raw;
  if (column.kind === 'number' || column.kind === 'km') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

/** Excel のシート名の決まり(31文字まで、: \ / ? * [ ] を使えない、先頭・末尾の ' を使えない、空は不可)に直す。 */
export function sanitizeSheetName(name: string, fallback = 'シート'): string {
  const cleaned = name
    .replace(/[:\\/?*[\]]/g, '_')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字はシート名に使えないため取り除く
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();
  const base = cleaned === '' || cleaned.toLowerCase() === 'history' ? fallback : cleaned;
  return [...base].slice(0, 31).join('');
}

/**
 * 重ならないシート名の並び(同じ名前は「山田 太郎 (2)」のようにする。Excel は大文字小文字を区別しない)。
 */
export function uniqueSheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = sanitizeSheetName(name);
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = [...base].slice(0, 31 - suffix.length).join('') + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** 年度(4月始まり)の12か月 'YYYY-MM'。 */
export function fiscalYearMonths(fiscalYear: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((i + 3) % 12) + 1;
    const year = month >= 4 ? fiscalYear : fiscalYear + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}
