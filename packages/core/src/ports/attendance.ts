import type { TravelLegKind, TravelModeCode, VisitSource, VisitStatus, WeatherCode } from '../domain/model';

/** 時間帯 `[start, end)`。片方だけ入力された時間帯は他方が null。 */
export interface InstantRangeValue {
  start: Date | null;
  end: Date | null;
}

export interface AttendanceDayRow {
  id: string;
  staffId: string;
  businessDate: string;
  shoppingErrandCount: number | null;
  remarks: string | null;
  overriddenFields: string[];
  rowVersion: number;
}

export interface VisitRow {
  id: string;
  seq: number;
  customerId: string | null;
  plannedPeriod: InstantRangeValue | null;
  actualPeriod: InstantRangeValue | null;
  status: VisitStatus;
  source: VisitSource;
  externalEventId: string | null;
  label: string | null;
  overriddenFields: string[];
}

export interface WorkSegmentRow {
  id: string;
  seq: number;
  period: InstantRangeValue | null;
  description: string | null;
  overriddenFields: string[];
}

export interface TravelLegRow {
  id: string;
  kind: TravelLegKind;
  seq: number;
  fromVisitId: string | null;
  toVisitId: string | null;
  plannedMinutes: number | null;
  /** numeric(6,2) の文字列('6.00')。 */
  distanceKm: string | null;
  weather: WeatherCode | null;
  /** 移動手段(移動を作る・計算し直すときのスタッフの staff.travel_mode。未設定のスタッフは car)。 */
  transportMode: TravelModeCode | null;
  overriddenFields: string[];
}

/** 1日分の勤怠(入れ物と、その日の訪問・業務時間・移動)。 */
export interface AttendanceDayRows {
  staffId: string;
  businessDate: string;
  day: AttendanceDayRow | null;
  visits: VisitRow[];
  segments: WorkSegmentRow[];
  legs: TravelLegRow[];
}

/** 1日分の書き込み(差分)。削除 → 更新 → 追加の順に適用する。 */
export interface AttendanceDayWrite {
  day: Pick<AttendanceDayRow, 'shoppingErrandCount' | 'remarks' | 'overriddenFields'>;
  visits: { insert: VisitRow[]; update: VisitRow[]; delete: string[] };
  segments: { insert: WorkSegmentRow[]; update: WorkSegmentRow[]; delete: string[] };
  legs: { insert: TravelLegRow[]; update: TravelLegRow[]; delete: string[] };
}

export interface AttendanceRepository {
  loadDay(staffId: string, businessDate: string): Promise<AttendanceDayRows>;
  /**
   * 入れ物の行が無ければ作り、その行を SELECT … FOR UPDATE で押さえてから1日分を読む(同じ日への
   * 手入力とカレンダー反映の読み→書きを直列にする)。UoW のトランザクションの中で呼ぶ。existed は呼ぶ前から
   * 入れ物があったか(無かった日の版は 0 とみなす)。
   */
  lockDay(
    staffId: string,
    businessDate: string,
    newDayId: string,
  ): Promise<AttendanceDayRows & { day: AttendanceDayRow; existed: boolean }>;
  /** 両端を含む期間の日ごとの勤怠(記録のある日だけ)。 */
  loadRange(staffId: string, fromDate: string, toDate: string): Promise<AttendanceDayRows[]>;
  findDayById(dayId: string): Promise<AttendanceDayRows | null>;
  /**
   * 1日分の差分を書き、入れ物の row_version を1上げた行を返す。expectedVersion を渡すと、その版のときだけ
   * 書く(違えば conflict)。締め済みの月はトリガーが拒否する(locked)。訪問の時間帯の重なりは拒否しない。
   */
  writeDay(dayId: string, write: AttendanceDayWrite, expectedVersion?: number): Promise<AttendanceDayRow>;
  /**
   * 月の締め(status = 'locked')。締め済みなら何もしない(締めた日時・締めた人を変えない)。同じ月の勤怠を書いている
   * トランザクションがあれば、その終わりを待ってから締める(DB のトリガー)。締めの解除はアプリからはできない
   * (運用の platform.unlock_attendance_period)。
   */
  lockPeriod(staffId: string, yearMonth: string, lockedBy: string, at: Date): Promise<void>;
  /** その月の出勤簿が締め済みのスタッフ(領収書の一覧の「取消せるか」の表示に使う。ロックは取らない)。 */
  listLockedStaffIds(yearMonth: string): Promise<string[]>;
  /**
   * そのスタッフのその月('YYYY-MM')の出勤簿が締め済みか(DB の attendance_period_is_locked)。締めと同じ
   * (テナント・スタッフ・月)のアドバイザリロックを共有で取ってから読み、トランザクションの終わりまで持つ:
   * 締めている途中ならその終わりを待ち、読んだ後に締めようとする処理はこのトランザクションの終わりを待つ。
   * 締めた月に書かせない判定(領収書の登録・取消)はこれで読む。
   */
  isPeriodLocked(staffId: string, yearMonth: string): Promise<boolean>;
}
