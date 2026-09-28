import {
  GENDER_LABELS,
  type Gender,
  genderSchema,
  idSchema,
  STAFF_IMPORT_MAX_ROWS,
  STAFF_ROLE_LABELS,
  STAFF_SHEET_COLUMNS,
  STAFF_SHEET_NAME,
  type StaffImportIssue,
  type StaffRole,
  type StaffSheetColumnKey,
  staffFieldSchemas,
  staffRoleSchema,
  TRAVEL_MODE_LABELS,
  type TravelModeCode,
  travelModeSchema,
} from '@katahimo/shared';
import { normalizeEmailForIndex, splitJapaneseKana } from '../pii';
import {
  cellText,
  type ImportCell,
  normalizeHeader,
  type ReportAiImportSheet,
} from '../reports/reportAiImport';
import { isStaffCalendarAllowed, normalizeCalendarId, type TenantCalendarSettings } from '../schedule';
import {
  CALENDAR_NOT_ALLOWED_MESSAGE,
  CANNOT_DEMOTE_SELF_MESSAGE,
  CANNOT_RETIRE_SELF_MESSAGE,
  LAST_ADMIN_MESSAGE,
  STAFF_EMAIL_CONFLICT_MESSAGES,
} from './staffAdminMessages';

/**
 * 管理画面「スタッフ」の xlsx の書き出し・取込の純関数(xlsx の読み書きそのもの(exceljs)は API 側で、ここはシートの
 * セルの表だけを扱う)。列は @katahimo/shared の STAFF_SHEET_COLUMNS(見出しで見分け、並び順は問わない)。
 *
 * - 読むシートは「スタッフ」、無ければ先頭のシート。見出しの行は上から10行までで「氏名」「メールアドレス」の
 *   両方がある行(見出しは NFKC・小文字にし、空白・記号を落として比べる。列のキー名(email 等)も受け付ける)。
 *   知らない見出しの列は読まずに知らせる。
 * - 見出しのある列はセルの値で上書きし、空欄は値の削除(氏名・メールアドレスは必須)。見出しの無い列は今の値のまま。
 *   セルは画面の登録・更新と同じ規則(staffFieldSchemas)で確かめる。役割・移動手段・性別は日本語の名前か値の
 *   コード、退職日は日付のセルか「YYYY-MM-DD」「YYYY/MM/DD」。
 * - 突き合わせは ID(空欄でなければ。知らない ID は誤り)、無ければメールアドレス(主)。どちらも無ければ新しいスタッフ。
 * - 業務の規則は画面の更新と同じ: 自分自身の管理者権限の解除・退職日の設定はできない、退職日の決まっていない
 *   管理者が1人は残る(取込の後の状態で確かめる)、予定のカレンダーはテナントの許可の一覧に合うもの(変えるときだけ)、
 *   メールアドレス・サブメールはテナントの中で重ならない。
 */

export type StaffSheet = ReportAiImportSheet;

const LABEL_OF = new Map<StaffSheetColumnKey, string>(STAFF_SHEET_COLUMNS.map((c) => [c.key, c.label]));
export const staffSheetLabelOf = (key: StaffSheetColumnKey): string => LABEL_OF.get(key) ?? key;

/** 取込で上書きできる項目(ID 以外の列)。 */
export type StaffSheetFieldKey = Exclude<StaffSheetColumnKey, 'id'>;

/** セルを読んだ値(null は空欄 = 値の削除)。 */
export interface StaffSheetValues {
  name: string;
  kana: string | null;
  email: string;
  altEmail: string | null;
  phone: string | null;
  /** 空欄は null(新しいスタッフは「スタッフ」、既存のスタッフは誤り)。 */
  role: StaffRole | null;
  retiredOn: string | null;
  homeAddress: string | null;
  travelMode: TravelModeCode | null;
  gender: Gender | null;
  scheduleCalendarId: string | null;
}

export interface ParsedStaffSheetRow {
  /** Excel の行番号(1始まり)。 */
  row: number;
  id: string | null;
  /** 見出しのある列の値だけ。 */
  values: Partial<StaffSheetValues>;
}

export interface ParsedStaffSheet {
  /** 見出しのある列(ID を除く)。 */
  columns: StaffSheetFieldKey[];
  /** 空でない行の数(誤りの行を含む)。 */
  rowCount: number;
  /** 誤りの無い行。 */
  rows: ParsedStaffSheetRow[];
  errors: StaffImportIssue[];
  warnings: StaffImportIssue[];
}

const HEADER_SEARCH_ROWS = 10;

function columnKeyOfHeader(text: string): StaffSheetColumnKey | null {
  const normalized = normalizeHeader(text);
  if (!normalized) return null;
  for (const column of STAFF_SHEET_COLUMNS) {
    if (normalized === normalizeHeader(column.label) || normalized === column.key.toLowerCase()) {
      return column.key;
    }
  }
  return null;
}

function pickSheet(sheets: readonly StaffSheet[]): StaffSheet | null {
  const target = normalizeHeader(STAFF_SHEET_NAME);
  return sheets.find((s) => normalizeHeader(s.name) === target) ?? sheets[0] ?? null;
}

const isBlankRow = (row: readonly ImportCell[]) => row.every((cell) => cellText(cell) === '');

/** 日本語の名前(または値のコード)→ 値。 */
function codeOf<C extends string>(labels: Record<C, string>, text: string): C | null {
  const normalized = text.normalize('NFKC').trim();
  for (const [code, label] of Object.entries(labels) as [C, string][]) {
    if (normalized === label.normalize('NFKC') || normalized.toLowerCase() === code) return code;
  }
  return null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  if (year < 2000 || year > 2100) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Excel の日付のシリアル値の 0 日目(1899-12-30)。 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

/** 退職日のセル(日付のセル・シリアル値・「YYYY-MM-DD」「YYYY/MM/DD」)。読めなければ undefined。 */
export function parseSheetDate(cell: ImportCell): string | null | undefined {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return undefined;
    return validDate(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate()) ?? undefined;
  }
  if (typeof cell === 'number') {
    if (!Number.isInteger(cell)) return undefined;
    const date = new Date(EXCEL_EPOCH_MS + cell * DAY_MS);
    return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) ?? undefined;
  }
  const text = cellText(cell).normalize('NFKC');
  if (!text) return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (!m) return undefined;
  return validDate(Number(m[1]), Number(m[2]), Number(m[3])) ?? undefined;
}

/** 文字の項目のセル(数のセルは文字にする)。 */
function textOf(cell: ImportCell): string {
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  if (cell instanceof Date) return '';
  return cellText(cell);
}

type CellResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** zod のスキーマ(core は zod に直接は依存しないため、使う形だけ)。 */
interface FieldSchema<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
}

function bySchema<T>(schema: FieldSchema<T>, input: unknown): CellResult<T> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? '値が正しくありません' };
}

function byLabel<C extends string>(
  labels: Record<C, string>,
  schema: FieldSchema<C>,
  cell: ImportCell,
): CellResult<C | null> {
  const text = textOf(cell);
  if (!text) return { ok: true, value: null };
  const code = codeOf(labels, text);
  if (code && schema.safeParse(code).success) return { ok: true, value: code };
  return {
    ok: false,
    message: `「${Object.values<string>(labels).join('」「')}」のどれかを入力してください`,
  };
}

function emailOf(text: string): CellResult<string> {
  const result = bySchema(staffFieldSchemas.email, text);
  return result.ok ? { ok: true, value: normalizeEmailForIndex(result.value) } : result;
}

/** 1つのセルを項目の規則で読む。 */
function readField(key: StaffSheetFieldKey, cell: ImportCell): CellResult<unknown> {
  const text = textOf(cell);
  switch (key) {
    case 'name':
      return bySchema(staffFieldSchemas.name, text);
    case 'email':
      if (!text) return { ok: false, message: 'メールアドレスを入力してください' };
      return emailOf(text);
    case 'altEmail':
      return text ? emailOf(text) : { ok: true, value: null };
    case 'kana':
      return bySchema(staffFieldSchemas.kana, text);
    case 'phone':
      return bySchema(staffFieldSchemas.phone, text);
    case 'homeAddress':
      return bySchema(staffFieldSchemas.homeAddress, text);
    case 'scheduleCalendarId': {
      const result = bySchema(staffFieldSchemas.scheduleCalendarId, text);
      return result.ok && typeof result.value === 'string'
        ? { ok: true, value: normalizeCalendarId(result.value) }
        : result;
    }
    case 'role':
      return byLabel(STAFF_ROLE_LABELS, staffRoleSchema, cell);
    case 'travelMode':
      return byLabel(TRAVEL_MODE_LABELS, travelModeSchema, cell);
    case 'gender':
      return byLabel(GENDER_LABELS, genderSchema, cell);
    case 'retiredOn': {
      const date = parseSheetDate(cell);
      return date === undefined
        ? { ok: false, message: '日付は「YYYY-MM-DD」の形で入力してください' }
        : { ok: true, value: date };
    }
  }
}

/** シートのセルの表を読んで、行ごとの値と誤り・知らせにする(今のスタッフとの突き合わせは planStaffImport)。 */
export function parseStaffSheet(sheets: readonly StaffSheet[]): ParsedStaffSheet {
  const empty = (message: string): ParsedStaffSheet => ({
    columns: [],
    rowCount: 0,
    rows: [],
    errors: [{ row: null, message }],
    warnings: [],
  });
  const sheet = pickSheet(sheets);
  if (!sheet) return empty('シートがありません');
  let headerIndex = -1;
  for (let r = 0; r < Math.min(HEADER_SEARCH_ROWS, sheet.rows.length); r++) {
    const keys = (sheet.rows[r] ?? []).map((cell) => columnKeyOfHeader(cellText(cell)));
    if (keys.includes('name') && keys.includes('email')) {
      headerIndex = r;
      break;
    }
  }
  if (headerIndex < 0) {
    return empty(`シート「${sheet.name}」に「氏名」「メールアドレス」の見出しの行が見つかりません`);
  }
  const errors: StaffImportIssue[] = [];
  const warnings: StaffImportIssue[] = [];
  const headerRowNumber = headerIndex + 1;
  const columnIndex = new Map<StaffSheetColumnKey, number>();
  (sheet.rows[headerIndex] ?? []).forEach((cell, index) => {
    const text = cellText(cell);
    if (!text) return;
    const key = columnKeyOfHeader(text);
    if (!key) {
      warnings.push({ row: headerRowNumber, message: `列「${text}」は読みません` });
    } else if (columnIndex.has(key)) {
      errors.push({ row: headerRowNumber, message: `見出し「${staffSheetLabelOf(key)}」の列が2つあります` });
    } else {
      columnIndex.set(key, index);
    }
  });
  const columns = STAFF_SHEET_COLUMNS.map((c) => c.key).filter(
    (key): key is StaffSheetFieldKey => key !== 'id' && columnIndex.has(key),
  );

  const dataRows = sheet.rows
    .map((cells, index) => ({ cells, row: index + 1 }))
    .slice(headerIndex + 1)
    .filter(({ cells }) => !isBlankRow(cells));
  if (dataRows.length > STAFF_IMPORT_MAX_ROWS) {
    errors.push({ row: null, message: `スタッフの行が多すぎます(${STAFF_IMPORT_MAX_ROWS}行まで)` });
    return { columns, rowCount: dataRows.length, rows: [], errors, warnings };
  }

  const rows: ParsedStaffSheetRow[] = [];
  for (const { cells, row } of dataRows) {
    const cellOf = (key: StaffSheetColumnKey) => {
      const index = columnIndex.get(key);
      return index === undefined ? null : cells[index];
    };
    const rowErrors: string[] = [];
    let id: string | null = null;
    const idText = columnIndex.has('id') ? textOf(cellOf('id')) : '';
    if (idText) {
      const parsed = idSchema.safeParse(idText.toLowerCase());
      if (parsed.success) id = parsed.data;
      else
        rowErrors.push(
          'ID の形が正しくありません(書き出したファイルの ID のままにするか、空欄にしてください)',
        );
    }
    const values: Partial<Record<StaffSheetFieldKey, unknown>> = {};
    for (const key of columns) {
      const result = readField(key, cellOf(key));
      if (result.ok) values[key] = result.value;
      else rowErrors.push(`${staffSheetLabelOf(key)}: ${result.message}`);
    }
    if (typeof cellOf('phone') === 'number') {
      warnings.push({ row, message: '電話が数のセルです。先頭の 0 が消えていないか確かめてください' });
    }
    if (rowErrors.length > 0) {
      for (const message of rowErrors) errors.push({ row, message });
      continue;
    }
    rows.push({ row, id, values: values as Partial<StaffSheetValues> });
  }
  return { columns, rowCount: dataRows.length, rows, errors, warnings };
}

// ─────────────────────────────────────────────────────────────
// 今のスタッフとの突き合わせ
// ─────────────────────────────────────────────────────────────

/** 突き合わせに使う今のスタッフ(ports の StaffRecord + 予定のカレンダー)。 */
export interface StaffSheetCurrent {
  id: string;
  displayName: string;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string;
  altEmail: string | null;
  phone: string | null;
  role: StaffRole;
  retiredOn: string | null;
  homeAddress: string | null;
  travelMode: TravelModeCode | null;
  gender: Gender | null;
  scheduleCalendarId: string | null;
}

/** 取込の後の値(役割は必ず決まる)。 */
export type StaffSheetFinal = Omit<StaffSheetValues, 'role'> & { role: StaffRole };

export interface StaffImportPlanEntry {
  row: number;
  kind: 'create' | 'update' | 'unchanged';
  /** 既存のスタッフ(create は null)。 */
  staffId: string | null;
  /** 取込の後の値。 */
  next: StaffSheetFinal;
  /** 変わる項目(create は値のある項目)。 */
  fields: StaffSheetFieldKey[];
}

export interface StaffImportPlan {
  entries: StaffImportPlanEntry[];
  errors: StaffImportIssue[];
}

export interface StaffImportContext {
  staff: readonly StaffSheetCurrent[];
  actorStaffId: string;
  calendarSettings: TenantCalendarSettings;
}

function currentValues(s: StaffSheetCurrent): StaffSheetFinal {
  return {
    name: s.displayName,
    kana: [s.familyNameKana, s.givenNameKana].filter(Boolean).join(' ') || null,
    email: s.email,
    altEmail: s.altEmail,
    phone: s.phone,
    role: s.role,
    retiredOn: s.retiredOn,
    homeAddress: s.homeAddress,
    travelMode: s.travelMode,
    gender: s.gender,
    scheduleCalendarId: s.scheduleCalendarId,
  };
}

/** 保存したときに今の値と同じになるか(カナは姓・名に分けて比べる)。 */
function sameValue(key: StaffSheetFieldKey, current: StaffSheetCurrent, next: StaffSheetFinal): boolean {
  if (key === 'kana') {
    const split = next.kana ? splitJapaneseKana(next.kana) : { familyNameKana: null, givenNameKana: null };
    return split.familyNameKana === current.familyNameKana && split.givenNameKana === current.givenNameKana;
  }
  return currentValues(current)[key] === next[key];
}

/**
 * 読んだ行を今のスタッフと突き合わせ、行ごとの作成・更新・変更なしと、業務の規則の誤りを返す。
 * 誤りのある行も entries に含める(誤りが1件でもあれば呼び出し側は反映しない)。
 */
export function planStaffImport(parsed: ParsedStaffSheet, context: StaffImportContext): StaffImportPlan {
  const errors: StaffImportIssue[] = [];
  const byId = new Map(context.staff.map((s) => [s.id, s]));
  const byEmail = new Map(context.staff.map((s) => [s.email, s]));
  const targetRow = new Map<string, number>();
  const entries: StaffImportPlanEntry[] = [];

  for (const { row, id, values } of parsed.rows) {
    let current: StaffSheetCurrent | null = null;
    if (id) {
      current = byId.get(id) ?? null;
      if (!current) {
        errors.push({
          row,
          message: 'この ID のスタッフはいません(新しいスタッフは ID を空欄にしてください)',
        });
        continue;
      }
    } else if (values.email) {
      current = byEmail.get(values.email) ?? null;
    }
    if (current) {
      const earlier = targetRow.get(current.id);
      if (earlier !== undefined) {
        errors.push({ row, message: `${earlier}行目と同じスタッフの行です` });
        continue;
      }
      targetRow.set(current.id, row);
    }
    const base: StaffSheetFinal = current
      ? currentValues(current)
      : {
          name: '',
          kana: null,
          email: '',
          altEmail: null,
          phone: null,
          role: 'staff',
          retiredOn: null,
          homeAddress: null,
          travelMode: null,
          gender: null,
          scheduleCalendarId: null,
        };
    const next: StaffSheetFinal = { ...base };
    for (const key of parsed.columns) {
      const value = values[key];
      if (key === 'role') {
        if (value === null || value === undefined) {
          if (current) errors.push({ row, message: '役割: 役割を入力してください' });
          continue;
        }
      }
      Object.assign(next, { [key]: value ?? null });
    }
    const fields = current
      ? parsed.columns.filter((key) => !sameValue(key, current, next))
      : parsed.columns.filter((key) => next[key] !== null && next[key] !== '');
    if (current && current.id === context.actorStaffId) {
      if (fields.includes('role') && next.role !== 'admin')
        errors.push({ row, message: CANNOT_DEMOTE_SELF_MESSAGE });
      if (fields.includes('retiredOn') && next.retiredOn)
        errors.push({ row, message: CANNOT_RETIRE_SELF_MESSAGE });
    }
    if (fields.includes('scheduleCalendarId') && next.scheduleCalendarId) {
      if (!isStaffCalendarAllowed(context.calendarSettings, next.scheduleCalendarId)) {
        errors.push({
          row,
          message: `${staffSheetLabelOf('scheduleCalendarId')}: ${CALENDAR_NOT_ALLOWED_MESSAGE}`,
        });
      }
    }
    entries.push({
      row,
      kind: current ? (fields.length > 0 ? 'update' : 'unchanged') : 'create',
      staffId: current?.id ?? null,
      next,
      fields,
    });
  }

  errors.push(...emailConflicts(context.staff, entries));
  if (removesLastAdmin(context.staff, entries)) errors.push({ row: null, message: LAST_ADMIN_MESSAGE });
  return { entries, errors: sortIssues(errors) };
}

/** 取込の後の状態で、メールアドレス・サブメールが重ならないか(ファイルの行の誤りにする)。 */
function emailConflicts(
  staff: readonly StaffSheetCurrent[],
  entries: readonly StaffImportPlanEntry[],
): StaffImportIssue[] {
  const fromFile = new Map(entries.filter((e) => e.staffId).map((e) => [e.staffId as string, e]));
  type Owner = { key: string; row: number | null };
  const final: { owner: Owner; email: string; altEmail: string | null }[] = [
    ...staff
      .filter((s) => !fromFile.has(s.id))
      .map((s) => ({ owner: { key: s.id, row: null }, email: s.email, altEmail: s.altEmail })),
    ...entries.map((e) => ({
      owner: { key: e.staffId ?? `row:${e.row}`, row: e.row },
      email: e.next.email,
      altEmail: e.next.altEmail,
    })),
  ];
  const errors: StaffImportIssue[] = [];
  const seen = new Map<string, Owner>();
  // 既存(ファイルに無い)のスタッフのアドレスを先に置き、ファイルの行はその後に置く(誤りはファイルの行に付ける)
  for (const { owner, email, altEmail } of final) {
    for (const [field, value] of [
      ['email', email],
      ['altEmail', altEmail],
    ] as const) {
      if (!value) continue;
      if (field === 'altEmail' && value === email) {
        if (owner.row !== null) {
          errors.push({
            row: owner.row,
            message: `${staffSheetLabelOf('altEmail')}: ${STAFF_EMAIL_CONFLICT_MESSAGES.altEmail}`,
          });
        }
        continue;
      }
      const other = seen.get(value);
      if (other && other.key !== owner.key) {
        if (owner.row !== null) {
          const where = other.row !== null ? `(${other.row}行目と重なっています)` : '';
          errors.push({
            row: owner.row,
            message: `${staffSheetLabelOf(field)}: ${STAFF_EMAIL_CONFLICT_MESSAGES[field]}${where}`,
          });
        }
        continue;
      }
      seen.set(value, owner);
    }
  }
  return errors;
}

/** 管理者を外す・退職させる行があり、取込の後に退職日の決まっていない管理者が1人もいなくなるか。 */
function removesLastAdmin(
  staff: readonly StaffSheetCurrent[],
  entries: readonly StaffImportPlanEntry[],
): boolean {
  const byId = new Map(staff.map((s) => [s.id, s]));
  const removes = entries.some((e) => {
    const current = e.staffId ? byId.get(e.staffId) : undefined;
    if (current?.role !== 'admin') return false;
    return (
      (e.fields.includes('role') && e.next.role !== 'admin') ||
      (e.fields.includes('retiredOn') && Boolean(e.next.retiredOn))
    );
  });
  if (!removes) return false;
  const nextOf = new Map(entries.filter((e) => e.staffId).map((e) => [e.staffId as string, e.next]));
  const finalStaff = [
    ...staff.map((s) => nextOf.get(s.id) ?? currentValues(s)),
    ...entries.filter((e) => !e.staffId).map((e) => e.next),
  ];
  return !finalStaff.some((s) => s.role === 'admin' && s.retiredOn === null);
}

function sortIssues(issues: StaffImportIssue[]): StaffImportIssue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => (a.issue.row ?? 0) - (b.issue.row ?? 0) || a.index - b.index)
    .map(({ issue }) => issue);
}

// ─────────────────────────────────────────────────────────────
// 書き出し(取込と同じ見出し。書き出したファイルはそのまま取り込める)
// ─────────────────────────────────────────────────────────────

/** 書き出すスタッフ(管理画面の一覧の形)。 */
export interface StaffSheetExportStaff {
  id: string;
  name: string;
  kana: string | null;
  email: string;
  altEmail: string | null;
  phone: string | null;
  role: StaffRole;
  retiredOn: string | null;
  homeAddress: string | null;
  travelMode: TravelModeCode | null;
  gender: Gender | null;
  scheduleCalendarId: string | null;
}

export interface StaffSheetExport {
  name: string;
  header: string[];
  /** すべて文字(日付も「YYYY-MM-DD」の文字)。空欄は null。 */
  rows: (string | null)[][];
}

/** スタッフの一覧をシート「スタッフ」の表にする(xlsx への書き込みは API 側)。 */
export function staffToSheet(staff: readonly StaffSheetExportStaff[]): StaffSheetExport {
  const cellOf = (s: StaffSheetExportStaff, key: StaffSheetColumnKey): string | null => {
    switch (key) {
      case 'role':
        return STAFF_ROLE_LABELS[s.role];
      case 'travelMode':
        return s.travelMode ? TRAVEL_MODE_LABELS[s.travelMode] : null;
      case 'gender':
        return s.gender ? GENDER_LABELS[s.gender] : null;
      default:
        return s[key] || null;
    }
  };
  return {
    name: STAFF_SHEET_NAME,
    header: STAFF_SHEET_COLUMNS.map((c) => c.label),
    rows: staff.map((s) => STAFF_SHEET_COLUMNS.map((c) => cellOf(s, c.key))),
  };
}
