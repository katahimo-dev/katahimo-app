import type { AttendanceColumnKey, AttendanceRowDataInput } from '@katahimo/shared';

/**
 * 出勤簿1日分(API の rowData)を画面で使う名前付きの形にする。
 *
 * API の rowData は出勤簿スプレッドシートの列記号(C/D/E…)をキーにしている(doc/03_データベース設計.md 3.3)。
 * 画面の部品が列記号を直接書かなくて済むよう、列記号との対応はこのファイルだけに書く
 * (列の意味は packages/core/src/domain/attendance/sheetLayout.ts と同じ。GAS版
 * PAST_SCHEDULE_SLOT_DEFS / PAST_SCHEDULE_MOVE_COLS)。
 */

export type SlotKey = 'slot1' | 'slot2' | 'slot3' | 'office1' | 'office2';

export interface SlotDef {
  key: SlotKey;
  kind: 'visit' | 'office';
  /** 予定の修正ダイアログの見出し(GAS版 label) */
  label: string;
  /** 名前の欄の見出し(GAS版 nameLabel) */
  nameLabel: string;
}

/** 訪問#1〜#3・事務作業#1〜#2(GAS版 PAST_SCHEDULE_SLOT_DEFS と同じ順・同じ文言)。 */
export const SLOT_DEFS: readonly SlotDef[] = [
  { key: 'slot1', kind: 'visit', label: '1件目の訪問', nameLabel: 'お客様・内容' },
  { key: 'slot2', kind: 'visit', label: '2件目の訪問', nameLabel: 'お客様・内容' },
  { key: 'slot3', kind: 'visit', label: '3件目の訪問', nameLabel: 'お客様・内容' },
  { key: 'office1', kind: 'office', label: '事務作業（1つ目）', nameLabel: 'したこと' },
  { key: 'office2', kind: 'office', label: '事務作業（2つ目）', nameLabel: 'したこと' },
];

export function slotDef(key: SlotKey): SlotDef {
  return SLOT_DEFS.find((d) => d.key === key) as SlotDef;
}

/** 1つの予定(お客様・内容 / 始め / 終わり)。 */
export interface SlotValues {
  name: string;
  start: string;
  end: string;
}

/** 予定ごとの列(名前・始め・終わり)。 */
const SLOT_COLUMNS: Record<SlotKey, Record<keyof SlotValues, AttendanceColumnKey>> = {
  slot1: { name: 'C', start: 'D', end: 'E' },
  slot2: { name: 'L', start: 'M', end: 'N' },
  slot3: { name: 'U', start: 'V', end: 'W' },
  office1: { name: 'X', start: 'Y', end: 'Z' },
  office2: { name: 'AA', start: 'AB', end: 'AC' },
};

/**
 * 「移動と距離・買い物代行・備考」パネルの項目(予定に付かない、その日全体の値)。
 * 天候は I列が「1件目 → 2件目」、R列が「2件目 → 3件目」の移動時間に掛かる(「雪」なら1.3倍)。
 */
export interface DayDetailValues {
  /** 家 → 1件目の距離(km) */
  commuteKm: string;
  /** 1件目 → 2件目の天候(「雪」なら移動時間 × 1.3) */
  leg12Weather: string;
  /** 1件目 → 2件目の移動時間(分) */
  leg12Minutes: string;
  /** 1件目 → 2件目の距離(km) */
  leg12Km: string;
  /** 2件目 → 3件目の天候(「雪」なら移動時間 × 1.3) */
  leg23Weather: string;
  /** 2件目 → 3件目の移動時間(分) */
  leg23Minutes: string;
  /** 2件目 → 3件目の距離(km) */
  leg23Km: string;
  /** 最後の訪問 → 家の距離(km) */
  leavingKm: string;
  /** 買い物代行をした回数 */
  shoppingCount: string;
  /** 備考 */
  remarks: string;
}

export type DayDetailField = keyof DayDetailValues;

const DETAIL_COLUMNS: Record<DayDetailField, AttendanceColumnKey> = {
  commuteKm: 'AI',
  leg12Weather: 'I',
  leg12Minutes: 'H',
  leg12Km: 'AG',
  leg23Weather: 'R',
  leg23Minutes: 'Q',
  leg23Km: 'AH',
  leavingKm: 'AJ',
  shoppingCount: 'AN',
  remarks: 'AO',
};

/** 画面で扱う1日分。 */
export interface DayRecord {
  slots: Record<SlotKey, SlotValues>;
  detail: DayDetailValues;
}

type RowData = Partial<Record<AttendanceColumnKey, string | undefined>>;

const cell = (rowData: RowData, col: AttendanceColumnKey) => rowData[col] ?? '';

export function toDayRecord(rowData: RowData): DayRecord {
  const slots = Object.fromEntries(
    SLOT_DEFS.map(({ key }) => {
      const cols = SLOT_COLUMNS[key];
      return [
        key,
        { name: cell(rowData, cols.name), start: cell(rowData, cols.start), end: cell(rowData, cols.end) },
      ];
    }),
  ) as Record<SlotKey, SlotValues>;
  const detail = Object.fromEntries(
    (Object.keys(DETAIL_COLUMNS) as DayDetailField[]).map((field) => [
      field,
      cell(rowData, DETAIL_COLUMNS[field]),
    ]),
  ) as unknown as DayDetailValues;
  return { slots, detail };
}

/** 予定が入っているか(始め・終わりの両方がある。GAS版 filled 判定)。 */
export function isSlotFilled(slot: SlotValues): boolean {
  return Boolean(slot.start && slot.end);
}

/** 予定1つを保存するときに送る列(他の予定の列には触れない)。 */
export function slotPatch(key: SlotKey, values: SlotValues): AttendanceRowDataInput {
  const cols = SLOT_COLUMNS[key];
  return { [cols.name]: values.name, [cols.start]: values.start, [cols.end]: values.end };
}

/**
 * 「移動と距離・買い物代行・備考」を保存するときに送る列(GAS版 PAST_SCHEDULE_MOVE_COLS + AN + AO)。
 * GAS版と同じく、画面に出ていない区間の欄(訪問が1件の日の「1件目 → 2件目」等)は空で送る
 * (GAS版は入力欄が無い列を '' として保存していた)。天候は例外で、出ていなくても今の値のまま送る(`shownDetailFields`)。
 */
export function detailPatch(
  values: DayDetailValues,
  shownFields: ReadonlySet<DayDetailField>,
): AttendanceRowDataInput {
  return Object.fromEntries(
    (Object.keys(DETAIL_COLUMNS) as DayDetailField[]).map((field) => [
      DETAIL_COLUMNS[field],
      shownFields.has(field) ? values[field] : '',
    ]),
  );
}
