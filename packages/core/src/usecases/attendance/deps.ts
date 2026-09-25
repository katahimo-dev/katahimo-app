import type { AppLogPort } from '../../ports/appLog';
import type { AttendanceDayRepositoryPort } from '../../ports/attendanceDays';
import type { CryptoPort } from '../../ports/crypto';
import type { MirrorPort } from '../../ports/mirror';
import type {
  ReceiptRepositoryPort,
  StaffRepositoryPort,
  TenantRepositoryPort,
} from '../../ports/repositories';
import type { SchedulePort } from '../../ports/schedule';

/** 勤怠(出勤簿)系usecaseの共通の依存。 */
export interface AttendanceDeps {
  attendanceDays: AttendanceDayRepositoryPort;
  staff: StaffRepositoryPort;
  crypto: CryptoPort;
  /** 出勤簿スプレッドシート等へのミラー要求をoutboxに積む。 */
  mirror: MirrorPort;
  appLog: AppLogPort;
  /** 「今日」の基準(月ロック・夜間バッチの対象日)。省略時は現在時刻。テストで固定するために注入できる。 */
  now?: () => Date;
}

export interface AttendanceMonthDeps extends AttendanceDeps {
  receipts: ReceiptRepositoryPort;
}

export interface CalendarSyncDeps extends AttendanceDeps {
  schedule: SchedulePort;
}

export interface NightlyCalendarSyncDeps extends CalendarSyncDeps {
  tenants: TenantRepositoryPort;
}
