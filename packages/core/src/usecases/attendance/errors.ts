export type AttendanceErrorCode =
  /** 対象スタッフが存在しない(他テナントのIDを含む) */
  | 'staff_not_found'
  /** 管理者専用の操作、または一般スタッフが他スタッフを指定した */
  | 'forbidden'
  /** 月ロック(当月以外の日付は手入力で修正できない) */
  | 'locked'
  /** 日付・期間の指定が不正 */
  | 'invalid_request'
  /** カレンダー予定(SchedulePort)が取得できなかった */
  | 'schedule_unavailable';

/** 勤怠usecaseが呼び出し元(APIルート)に返す、利用者に見せてよいエラー。 */
export class AttendanceError extends Error {
  constructor(
    readonly code: AttendanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AttendanceError';
  }
}
