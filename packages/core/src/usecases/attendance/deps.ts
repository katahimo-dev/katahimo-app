import type { AppLogPort } from '../../ports/appLog';
import type { SchedulePort } from '../../ports/schedule';
import type { TenantDirectoryPort } from '../../ports/tenants';
import type { UnitOfWorkPort } from '../../ports/unitOfWork';
import type { Clock } from '../requestMeta';

/** 勤怠(出勤簿)の usecase の依存。 */
export interface AttendanceDeps extends Clock {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

export interface CalendarSyncDeps extends AttendanceDeps {
  schedule: SchedulePort;
}

export interface NightlyCalendarSyncDeps extends CalendarSyncDeps {
  tenants: TenantDirectoryPort;
  /**
   * 予定を読めるテナントの slug(SCHEDULE_PROVIDER=gas_bridge の GAS_BRIDGE_TENANT。Bridge は1つのテナントの予定しか読めない)。
   * 設定されていれば他のテナントは処理せずに飛ばす(INFO を1件残す。毎晩失敗で終わらせない)。null・未指定なら全テナント。
   */
  scheduleTenantSlug?: string | null | undefined;
}
