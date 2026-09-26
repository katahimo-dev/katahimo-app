import type { OutboxTopic } from '@katahimo/core/domain';
import type {
  TenantRecord,
  TenantRepositories,
  UnitOfWorkOptions,
  UnitOfWorkPort,
} from '@katahimo/core/ports';
import { type Database, type Tx, withTenant } from './client';
import { mapDatabaseError } from './errors';
import { findTenantById, findTenantCalendarSettings } from './repositories/platform/tenants';
import { DrizzleAppLogReadRepository } from './repositories/tenant/appLogs';
import { DrizzleAttendanceRepository } from './repositories/tenant/attendance';
import {
  DrizzleStaffBusyBlockRepository,
  DrizzleStaffCalendarRepository,
  DrizzleTenantRetentionRepository,
} from './repositories/tenant/calendars';
import {
  DrizzleCareRecipientRepository,
  DrizzleCustomerAddressRepository,
  DrizzleCustomerContactRepository,
  DrizzleCustomerRepository,
  DrizzleCustomerSourceRecordRepository,
} from './repositories/tenant/customers';
import { DrizzlePushSubscriptionRepository } from './repositories/tenant/push';
import {
  DrizzleCareRecordRepository,
  DrizzleReceiptRepository,
  DrizzleStoredFileRepository,
} from './repositories/tenant/records';
import { DrizzlePasswordResetCodeRepository, DrizzleSessionRepository } from './repositories/tenant/sessions';
import {
  DrizzleAiPromptRepository,
  DrizzleEntityChangeWriter,
  DrizzleImportRunRepository,
  DrizzleOutboxWriter,
  DrizzleTenantSecretRepository,
  DrizzleTenantSettingsRepository,
} from './repositories/tenant/settings';
import { DrizzleStaffRepository } from './repositories/tenant/staff';

export interface UnitOfWorkConfig {
  /** 積まない outbox のトピック(MIRROR_TO_GOOGLE_SHEETS が無効ならスプレッドシートへのミラー)。 */
  skipOutboxTopics?: readonly OutboxTopic[];
}

/** トランザクションに結び付いたリポジトリ一式を作る(テスト・ワーカーの読み出しでも使う)。 */
export function bindRepositories(
  tx: Tx,
  tenantId: string,
  config: UnitOfWorkConfig = {},
): TenantRepositories {
  const skip = new Set(config.skipOutboxTopics ?? []);
  let tenant: Promise<TenantRecord> | null = null;
  return {
    tenantId,
    tenant() {
      tenant ??= findTenantById(tx, tenantId).then((t) => {
        if (!t) throw new Error(`テナントが見つかりません(tenantId=${tenantId})`);
        return t;
      });
      return tenant;
    },
    calendarSettings() {
      return findTenantCalendarSettings(tx, tenantId);
    },
    staff: new DrizzleStaffRepository(tx, tenantId),
    sessions: new DrizzleSessionRepository(tx, tenantId),
    passwordResetCodes: new DrizzlePasswordResetCodeRepository(tx, tenantId),
    customers: new DrizzleCustomerRepository(tx, tenantId),
    customerSourceRecords: new DrizzleCustomerSourceRecordRepository(tx, tenantId),
    customerAddresses: new DrizzleCustomerAddressRepository(tx, tenantId),
    customerContacts: new DrizzleCustomerContactRepository(tx, tenantId),
    careRecipients: new DrizzleCareRecipientRepository(tx, tenantId),
    attendance: new DrizzleAttendanceRepository(tx, tenantId),
    careRecords: new DrizzleCareRecordRepository(tx, tenantId),
    receipts: new DrizzleReceiptRepository(tx, tenantId),
    storedFiles: new DrizzleStoredFileRepository(tx, tenantId),
    settings: new DrizzleTenantSettingsRepository(tx, tenantId),
    secrets: new DrizzleTenantSecretRepository(tx, tenantId),
    aiPrompts: new DrizzleAiPromptRepository(tx, tenantId),
    importRuns: new DrizzleImportRunRepository(tx, tenantId),
    staffCalendars: new DrizzleStaffCalendarRepository(tx, tenantId),
    busyBlocks: new DrizzleStaffBusyBlockRepository(tx, tenantId),
    pushSubscriptions: new DrizzlePushSubscriptionRepository(tx, tenantId),
    outbox: new DrizzleOutboxWriter(tx, tenantId, skip),
    appLogs: new DrizzleAppLogReadRepository(tx, tenantId),
    entityChanges: new DrizzleEntityChangeWriter(tx, tenantId),
    retention: new DrizzleTenantRetentionRepository(tx, tenantId),
  };
}

/**
 * Unit of Work の Drizzle 実装。1回の run が1トランザクション(withTenant でテナントを1回だけ設定)で、
 * work の中の全てのリポジトリがそのトランザクションを使う。DB の制約・トリガーの拒否は DomainError
 * (conflict / locked)にして投げ直す。
 */
export class DrizzleUnitOfWork implements UnitOfWorkPort {
  constructor(
    private readonly db: Database,
    private readonly config: UnitOfWorkConfig = {},
  ) {}

  async run<T>(
    tenantId: string,
    work: (repos: TenantRepositories) => Promise<T>,
    options: UnitOfWorkOptions = {},
  ): Promise<T> {
    try {
      return await withTenant(this.db, tenantId, (tx) => work(bindRepositories(tx, tenantId, this.config)), {
        actorId: options.actorId ?? null,
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
