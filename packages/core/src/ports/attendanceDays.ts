import type { EncryptedField } from './repositories';

/**
 * 勤怠(出勤簿)1日分。rowData は domain/attendance の AttendanceRowData(入力列のみ)をJSON化して
 * 暗号化したもの。労働時間・残業などの派生値は保存しない(常に rowData から都度計算する)。
 */
export interface AttendanceDayRecord {
  id: string;
  tenantId: string;
  staffId: string;
  /** 'YYYY-MM-DD'(JST) */
  businessDate: string;
  rowData: EncryptedField;
  /** 自動転記後に手で変更された列(ミラー時にスプレッドシートのセルを強調表示する)。 */
  changedFields: string[];
  /** 最後に変更したスタッフ(本人または管理者)。システムの自動転記だけの行はnull。 */
  lastChangedByStaffId: string | null;
}

/** attendance_day_changes に追記する1件分(誰が・どの列を・変更前の値)。 */
export interface AttendanceDayHistoryEntry {
  /** システムによる自動転記(夜間バッチ)はnull。 */
  changedByStaffId: string | null;
  changedFields: string[];
  /** 変更前の rowData。初めて作成する場合はnull。 */
  previousRowData: EncryptedField | null;
}

export interface SaveAttendanceDayInput {
  tenantId: string;
  staffId: string;
  businessDate: string;
  rowData: EncryptedField;
  changedFields: string[];
  lastChangedByStaffId: string | null;
  history: AttendanceDayHistoryEntry;
}

export interface AttendanceDayRepositoryPort {
  findByStaffAndDate(
    tenantId: string,
    staffId: string,
    businessDate: string,
  ): Promise<AttendanceDayRecord | null>;
  /** ミラーワーカーが outbox_jobs.targetId から対象レコードを読み直すために使う。 */
  findById(tenantId: string, id: string): Promise<AttendanceDayRecord | null>;
  /**
   * 1日分を保存し(無ければ作成)、変更履歴を追記する。両者は同一トランザクションで行う
   * (履歴の無い変更が残らないように)。
   */
  save(input: SaveAttendanceDayInput): Promise<AttendanceDayRecord>;
  /**
   * 指定日のレコードを返す。無ければ emptyRowData で作成する(既にあれば一切変更しない)。
   * カレンダー反映で「勤怠集計」ミラーの対象日を指すレコードが必要な場合に使う。
   */
  findOrCreate(
    tenantId: string,
    staffId: string,
    businessDate: string,
    emptyRowData: EncryptedField,
  ): Promise<AttendanceDayRecord>;
  /** yearMonth は 'YYYY-MM'。 */
  listByStaffAndMonth(tenantId: string, staffId: string, yearMonth: string): Promise<AttendanceDayRecord[]>;
  /** startDate〜endDate は両端とも 'YYYY-MM-DD' で含む。 */
  listByStaffAndDateRange(
    tenantId: string,
    staffId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayRecord[]>;
}
