import type { AppLogPort } from '../../ports/appLog';
import type { AuditLogPort, CryptoPort } from '../../ports/crypto';
import type { SchedulePort } from '../../ports/schedule';
import type { TenantDirectoryPort } from '../../ports/tenants';
import type { UnitOfWorkPort } from '../../ports/unitOfWork';
import type { Clock } from '../requestMeta';

/** 勤怠(出勤簿)の usecase の依存。 */
export interface AttendanceDeps extends Clock {
  uow: UnitOfWorkPort;
  crypto: CryptoPort;
  appLog: AppLogPort;
  audit?: AuditLogPort;
}

export interface CalendarSyncDeps extends AttendanceDeps {
  schedule: SchedulePort;
}

export interface NightlyCalendarSyncDeps extends CalendarSyncDeps {
  tenants: TenantDirectoryPort;
}
