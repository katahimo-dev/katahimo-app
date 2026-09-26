import type { AppLogReadRepository } from './appLog';
import type { AttendanceRepository } from './attendance';
import type { StaffBusyBlockRepository, StaffCalendarRepository } from './calendars';
import type {
  CareRecipientRepository,
  CustomerAddressRepository,
  CustomerContactRepository,
  CustomerRepository,
  CustomerSourceRecordRepository,
} from './customers';
import type { ImportRunRepository } from './imports';
import type { TenantRetentionRepository } from './maintenance';
import type { EntityChangeWriter, OutboxWriter } from './outbox';
import type { CareRecordRepository, ReceiptRepository, StoredFileRepository } from './records';
import type { AiPromptRepository, TenantSecretRepository, TenantSettingsRepository } from './settings';
import type { PasswordResetCodeRepository, SessionRepository, StaffRepository } from './staff';
import type { TenantRecord } from './tenants';

/**
 * 1つのトランザクション(テナントのコンテキストを1回だけ設定したもの)に結び付いたリポジトリ一式。
 * メソッドはテナントIDを受け取らない(RLS とリポジトリの両方が UoW のテナントに限る)。
 */
export interface TenantRepositories {
  readonly tenantId: string;
  /** UoW のテナント(platform.tenants)。 */
  tenant(): Promise<TenantRecord>;
  staff: StaffRepository;
  sessions: SessionRepository;
  passwordResetCodes: PasswordResetCodeRepository;
  customers: CustomerRepository;
  customerSourceRecords: CustomerSourceRecordRepository;
  customerAddresses: CustomerAddressRepository;
  customerContacts: CustomerContactRepository;
  careRecipients: CareRecipientRepository;
  attendance: AttendanceRepository;
  careRecords: CareRecordRepository;
  receipts: ReceiptRepository;
  storedFiles: StoredFileRepository;
  settings: TenantSettingsRepository;
  secrets: TenantSecretRepository;
  aiPrompts: AiPromptRepository;
  importRuns: ImportRunRepository;
  staffCalendars: StaffCalendarRepository;
  busyBlocks: StaffBusyBlockRepository;
  outbox: OutboxWriter;
  entityChanges: EntityChangeWriter;
  retention: TenantRetentionRepository;
  /** 操作ログの閲覧(書き込みは AppLogPort。UoW のトランザクションとは独立に書く)。 */
  appLogs: AppLogReadRepository;
}

export interface UnitOfWorkOptions {
  /** 操作したスタッフ(DB のトリガーが変更者として記録する)。 */
  actorId?: string | null;
}

/**
 * 作業単位(Unit of Work)。work の中の読み書きは全て1トランザクションで行われ、work が例外を投げれば
 * outbox への積み込みも含めて全てロールバックされる。外部 API の呼び出し(カレンダー・Maps・Gemini・
 * 通知)は work の外で行う(トランザクションを長く開けたままにしない)。
 */
export interface UnitOfWorkPort {
  run<T>(
    tenantId: string,
    work: (repos: TenantRepositories) => Promise<T>,
    options?: UnitOfWorkOptions,
  ): Promise<T>;
}
