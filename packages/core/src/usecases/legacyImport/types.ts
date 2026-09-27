import type { LegacyImportRowSource } from '../../domain/model';
import type { AccidentReportContent, DailyReportContent } from '../../domain/reports/types';

/**
 * GAS版のスプレッドシートからの移行の取込で、シートの行を読んだ結果(読むのは ingestion の legacySheets)。
 * 日時は GAS版が書いた壁時計時刻('yyyy/MM/dd HH:mm:ss'。GAS版は Asia/Tokyo で書いた。テナントのタイムゾーンで解釈する)。
 */

/** 行ごとの結果の理由(ログ・画面には行番号とこのコードだけを出し、セルの値は出さない)。 */
export type LegacyRowIssueReason =
  // 取り込まない(誤り): 直してから流し直す
  | 'invalid_timestamp'
  | 'staff_missing'
  | 'staff_not_found'
  | 'staff_ambiguous'
  | 'customer_missing'
  | 'customer_not_found'
  | 'image_link_missing'
  | 'image_unavailable'
  | 'image_unsupported_type'
  | 'image_too_large'
  | 'record_missing'
  // 取り込まない(正しい扱い)
  | 'from_app'
  | 'locked'
  | 'edited_in_app'
  | 'duplicate'
  // 取り込んだが、値の一部を読めなかった・シートと違う
  | 'rating_invalid'
  | 'time_invalid'
  | 'amount_invalid'
  | 'customer_unlinked'
  | 'changed_in_sheet';

export type LegacyRowIssueLevel = 'error' | 'skipped' | 'warning';

const ISSUE_LEVELS: Record<LegacyRowIssueReason, LegacyRowIssueLevel> = {
  invalid_timestamp: 'error',
  staff_missing: 'error',
  staff_not_found: 'error',
  staff_ambiguous: 'error',
  customer_missing: 'error',
  customer_not_found: 'error',
  image_link_missing: 'error',
  image_unavailable: 'error',
  image_unsupported_type: 'error',
  image_too_large: 'error',
  record_missing: 'error',
  from_app: 'skipped',
  locked: 'skipped',
  edited_in_app: 'skipped',
  duplicate: 'skipped',
  rating_invalid: 'warning',
  time_invalid: 'warning',
  amount_invalid: 'warning',
  customer_unlinked: 'warning',
  changed_in_sheet: 'warning',
};

/** 行ごとの結果の説明(運用担当者の CLI の表示)。 */
export const LEGACY_ROW_ISSUE_LABELS: Record<LegacyRowIssueReason, string> = {
  invalid_timestamp: '日時の列を読めません',
  staff_missing: '担当スタッフの氏名が空です',
  staff_not_found: '担当スタッフの氏名に合うスタッフがいません(退職したスタッフを含めて探します)',
  staff_ambiguous: '担当スタッフの氏名に合うスタッフが2人以上います',
  customer_missing: '顧客ID が空です',
  customer_not_found: '顧客ID(RESERVA)に合うお客様がいません(先に顧客CSVを取り込みます)',
  image_link_missing: '写真の列が Google ドライブのファイルの URL ではありません',
  image_unavailable: '画像を読めません(ゴミ箱・削除済み、または共有されていません)',
  image_unsupported_type: '画像が JPEG・PNG・WebP ではありません(HEIC 等は変換してから登録し直します)',
  image_too_large: '画像が大きすぎます(1枚1.5MBまで)',
  record_missing: '取込済みの記録が見つかりません',
  from_app: '本アプリからのミラーの行です(取り込みません)',
  locked: '記録が確定済みのため直しません',
  edited_in_app: '取込の後に本アプリで直された記録のため、シートの内容で上書きしません',
  duplicate: '同じ内容の領収書・画像が既にあります(取り込みません)',
  rating_invalid: 'PSI・ES の評価を読めないため空にしました',
  time_invalid: '開始・終了の時刻を読めないため空にしました',
  amount_invalid: '金額を読めないため空にしました',
  customer_unlinked: '顧客ID に合うお客様がいないため、顧客名だけで取り込みました',
  changed_in_sheet: '取込の後にシートの行が変わっています(領収書は直しません)',
};

export function issueLevelOf(reason: LegacyRowIssueReason): LegacyRowIssueLevel {
  return ISSUE_LEVELS[reason];
}

export interface LegacyRowIssue {
  source: LegacyImportRowSource;
  /** シートの行番号(1始まり。1行目は見出し)。 */
  rowNumber: number;
  reason: LegacyRowIssueReason;
}

/** 1つのシートを読んだ結果。 */
export interface LegacySheetRows<T> {
  rows: T[];
  /** 読んだ時点の行ごとの結果(本アプリからのミラーの行・日時の読めない行・一部の値が読めない行)。 */
  issues: LegacyRowIssue[];
  /** 全てのセルが空の行の数(数えるだけ)。 */
  blankRowCount: number;
}

interface LegacyReportRowBase {
  rowNumber: number;
  /** 行を指すキー(シート・日時・担当・顧客ID(・開始時刻)。同じキーの2行目以降は '#2' 等を付ける)。 */
  sourceKey: string;
  /** 'yyyy/MM/dd HH:mm:ss'(壁時計時刻)。 */
  timestamp: string;
  /** User / Reporter 列(スタッフの氏名)。 */
  staffName: string;
  /** CustomerId 列(RESERVA の顧客ID)。 */
  customerExternalId: string;
}

/** 「日報」シートの1行。 */
export interface LegacyDailyReportRow extends LegacyReportRowBase {
  source: 'gas_daily_report';
  content: DailyReportContent;
  riskRating: number | null;
  esRating: number | null;
}

/** 「事故報告」シートの1行(事故報告・ヒヤリハット)。 */
export interface LegacyAccidentReportRow extends LegacyReportRowBase {
  source: 'gas_accident_report';
  /** ReportType 列('事故報告' | 'ヒヤリハット'。空は事故報告)。 */
  reportType: string;
  content: AccidentReportContent;
}

export type LegacyReportRow = LegacyDailyReportRow | LegacyAccidentReportRow;

/** 「領収書一覧」の1行。 */
export interface LegacyReceiptRow {
  source: 'gas_receipt';
  rowNumber: number;
  /** 画像の Drive のファイル ID(行を指すキー)。 */
  sourceKey: string;
  /** 日時の列('yyyy/MM/dd HH:mm:ss'。GAS版は OCR の領収書日時、無ければ報告の日時を書いた)。 */
  timestamp: string;
  /** ユーザーID 列(GAS版はスタッフの氏名を書いた)。 */
  staffName: string;
  /** 顧客ID 列(空はお客様の指定なし)。 */
  customerExternalId: string;
  customerName: string;
  /** 金額の列(書いたままの文字列。数値のセルは数字の文字列)。 */
  amount: string;
  storeName: string;
  /** 申し送り(GAS版は1回の登録の最初の1枚の行にだけ書いた)。 */
  handoffText: string;
}
