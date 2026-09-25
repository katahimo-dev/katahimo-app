import type { TravelLegKind, VisitSource, VisitStatus, WeatherCode } from '../domain/model';

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
  remarksEnc: Uint8Array | null;
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
  labelEnc: Uint8Array | null;
  overriddenFields: string[];
}

export interface WorkSegmentRow {
  id: string;
  seq: number;
  period: InstantRangeValue | null;
  descriptionEnc: Uint8Array | null;
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
  day: Pick<AttendanceDayRow, 'shoppingErrandCount' | 'remarksEnc' | 'overriddenFields'>;
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
   * 書く(違えば conflict)。締め済みの月はトリガーが拒否する(locked)。訪問の時間帯の重なりは conflict。
   */
  writeDay(dayId: string, write: AttendanceDayWrite, expectedVersion?: number): Promise<AttendanceDayRow>;
  /** 月の締め(status = 'locked')。 */
  lockPeriod(staffId: string, yearMonth: string, lockedBy: string, at: Date): Promise<void>;
}
