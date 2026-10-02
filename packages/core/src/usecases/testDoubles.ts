/**
 * usecase のテスト用のインメモリ実装。UoW はテナントごとのデータを1つの入れ物に持ち、work が例外を投げたら
 * 実行前の状態に戻す(トランザクションのロールバックと同じ振る舞い)。DB の一意制約のうちテストで確かめたいもの
 * (ログイン用メール・領収書の重複・outbox の dedupe_key)は同じように弾く。
 */

import type { PushNotice } from '@katahimo/shared';
import type { RateLimitBucket, RateLimitDecision, RateLimitRule } from '../domain';
import {
  conflict,
  consumeRateLimit,
  DomainError,
  EMPTY_CALENDAR_SETTINGS,
  isOutboxTopicEnabled,
  type OutboxTopicPolicy,
  refundRateLimit,
  STALE_PROMPT_MESSAGE,
  STALE_WRITE_MESSAGE,
} from '../domain';
import type { TenantCustomerImportSettings } from '../domain/customerCsv/importSettings';
import type { TenantSecretName } from '../domain/model';
import type { CareRecordContent } from '../domain/reports/careRecord';
import type { TenantCalendarSettings } from '../domain/schedule/calendarPolicy';
import type { AppLogEntry, AppLogPort, AppLogRecord } from '../ports/appLog';
import type {
  AttendanceDayRow,
  AttendanceDayRows,
  AttendanceDayWrite,
  AttendanceRepository,
  TravelLegRow,
  VisitRow,
  WorkSegmentRow,
} from '../ports/attendance';
import type { StaffCalendarRecord } from '../ports/calendars';
import type {
  CustomerCsvLocation,
  CustomerCsvSourceFile,
  CustomerCsvSourcePort,
} from '../ports/customerCsvSource';
import type {
  CareRecipientRecord,
  CustomerAddressRecord,
  CustomerContactRecord,
  CustomerRecord,
  CustomerSourceRecord,
} from '../ports/customers';
import type { ImportRunRecord } from '../ports/imports';
import type { IntegrationApiKeyRecord } from '../ports/integrations';
import type { LegacyImportedRow } from '../ports/legacyImport';
import type { MailerPort, MailMessage } from '../ports/mailer';
import type {
  AccidentReportMirrorPayload,
  AttendanceAggregateMirrorPayload,
  AttendanceDayMirrorPayload,
  DailyReportMirrorPayload,
  MirrorSenderPort,
  ReceiptMirrorPayload,
} from '../ports/mirrorSender';
import type { NotificationChannel, NotifierPort, NotifyResult } from '../ports/notifier';
import type {
  ClaimedOutboxMessage,
  EntityChangeInput,
  ExpiredOutboxMessage,
  OutboxMessageInput,
  OutboxQueuePort,
} from '../ports/outbox';
import type {
  PushSubscriptionRecord,
  WebPushSenderPort,
  WebPushSendOptions,
  WebPushSendResult,
  WebPushTarget,
} from '../ports/push';
import type { RateLimiterPort } from '../ports/rateLimiter';
import type {
  CareRecordListRow,
  CareRecordRow,
  ReceiptListFilter,
  ReceiptListRow,
  ReceiptRow,
  ReceiptUploadRow,
  StoredFileRow,
} from '../ports/records';
import type { ReservationCreateInput } from '../ports/reservations';
import type {
  ScheduleLightResult,
  SchedulePort,
  ScheduleRequestOptions,
  ScheduleTarget,
  ScheduleWithRouteOptions,
  ScheduleWithRouteResult,
} from '../ports/schedule';
import type { SecretBoxPort } from '../ports/secretBox';
import type { AiPromptRecord, TenantSecretRecord, TenantSettingsRecord } from '../ports/settings';
import type {
  NewStaffInput,
  PasswordResetCodeRecord,
  SessionRecord,
  StaffCredentials,
  StaffRecord,
} from '../ports/staff';
import type { StoragePort, StoredFile } from '../ports/storage';
import type {
  ProvisionTenantInput,
  TenantCalendarSettingsStore,
  TenantCustomerImportSettingsStore,
  TenantDirectoryPort,
  TenantProvisioningPort,
  TenantRecord,
} from '../ports/tenants';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth/deps';
import {
  emptyReportAiFakeData,
  fakeReportAiRepositories,
  type ReportAiFakeData,
} from './reportAiTestDoubles';

// ─────────────────────────────────────────────────────────────
// 入れ物
// ─────────────────────────────────────────────────────────────

interface StaffRow {
  record: StaffRecord;
  credentials: StaffCredentials & { failedCount: number; lockedUntil: Date | null };
  homeGeoCell: string | null;
}

export interface OutboxRow extends OutboxMessageInput {
  id: string;
  tenantId: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedUntil: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  completedAt: Date | null;
}

/** 1テナント分のデータ。 */
export interface TenantData extends ReportAiFakeData {
  staff: StaffRow[];
  sessions: (SessionRecord & { tokenHash: Uint8Array })[];
  resetCodes: PasswordResetCodeRecord[];
  customers: CustomerRecord[];
  sourceRecords: (CustomerSourceRecord & { lastImportRunId: string | null })[];
  addresses: CustomerAddressRecord[];
  contacts: CustomerContactRecord[];
  recipients: CareRecipientRecord[];
  days: AttendanceDayRow[];
  visits: (VisitRow & { staffId: string; businessDate: string })[];
  segments: (WorkSegmentRow & { staffId: string; businessDate: string })[];
  legs: (TravelLegRow & { staffId: string; businessDate: string })[];
  lockedPeriods: { staffId: string; yearMonth: string }[];
  /**
   * updatedAt は DB の set_updated_at() トリガーの代わり、createdAt は DB の既定値 now() の代わり
   * (直接 push した行はどちらも occurredAt を使う)。
   */
  careRecords: (CareRecordRow & { updatedAt?: Date; createdAt?: Date })[];
  careRecordRevisions: { careRecordId: string; body: CareRecordContent; changedBy: string | null }[];
  uploads: ReceiptUploadRow[];
  receipts: ReceiptRow[];
  files: StoredFileRow[];
  settings: TenantSettingsRecord;
  secrets: TenantSecretRecord[];
  aiPrompts: AiPromptRecord[];
  /** キー → 最新の版(ai_prompt_revisions の最大値)。 */
  aiPromptRevisions: Record<string, number>;
  /** ai_prompt_revisions.created_by(保存・既定に戻したスタッフ)。 */
  aiPromptRevisionAuthors: string[];
  importRuns: (ImportRunRecord & { message: string | null })[];
  legacyImportedRows: (LegacyImportedRow & { importRunId: string })[];
  integrationApiKeys: (IntegrationApiKeyRecord & { tokenHash: Uint8Array })[];
  calendars: StaffCalendarRecord[];
  busyBlocks: { staffId: string; start: Date; end: Date }[];
  /** 予約と確定した割当(reservations + reservation_assignments)。 */
  reservations: ReservationCreateInput[];
  pushSubscriptions: PushSubscriptionRecord[];
  outbox: OutboxRow[];
  entityChanges: EntityChangeInput[];
  appLogs: AppLogRecord[];
}

function emptyTenantData(): TenantData {
  return {
    staff: [],
    sessions: [],
    resetCodes: [],
    customers: [],
    sourceRecords: [],
    addresses: [],
    contacts: [],
    recipients: [],
    days: [],
    visits: [],
    segments: [],
    legs: [],
    lockedPeriods: [],
    careRecords: [],
    careRecordRevisions: [],
    uploads: [],
    receipts: [],
    files: [],
    settings: {
      careRecordRetentionDays: 1825,
      customerDataVersion: 0,
    },
    secrets: [],
    aiPrompts: [],
    aiPromptRevisions: {},
    aiPromptRevisionAuthors: [],
    importRuns: [],
    legacyImportedRows: [],
    integrationApiKeys: [],
    calendars: [],
    busyBlocks: [],
    reservations: [],
    pushSubscriptions: [],
    outbox: [],
    entityChanges: [],
    appLogs: [],
    ...emptyReportAiFakeData(),
  };
}

/** 購読の updated_at(テストでは並びだけが要るため、触るたびに1ミリ秒ずつ進む時刻)。 */
let pushTouch = 0;
const touchedAt = () => new Date(Date.UTC(2026, 0, 1) + ++pushTouch);

const sameBytes = (a: Uint8Array | null, b: Uint8Array | null) =>
  a !== null && b !== null && Buffer.from(a).equals(Buffer.from(b));

/** 領収書の一覧の条件に合う行(領収書日時・ID の新しい順)。 */
/** 一覧の1行(createdAtText は DB の created_at::text の代わりに ISO8601)。 */
function toCareRecordListRow(c: TenantData['careRecords'][number]): CareRecordListRow {
  const createdAt = c.createdAt ?? c.occurredAt;
  return {
    ...c,
    updatedAt: c.updatedAt ?? c.occurredAt,
    createdAt,
    createdAtText: createdAt.toISOString(),
  };
}

function matchingReceipts(data: TenantData, filter: ReceiptListFilter): ReceiptRow[] {
  return data.receipts
    .filter(
      (r) =>
        r.receiptedAt >= filter.from &&
        r.receiptedAt < filter.to &&
        (filter.staffId === undefined || r.staffId === filter.staffId) &&
        (filter.customerId === undefined || r.customerId === filter.customerId),
    )
    .sort(
      (a, b) => b.receiptedAt.getTime() - a.receiptedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
}

/** 一覧の1行(DB の結合の代わり)。 */
function receiptListRowOf(data: TenantData, r: ReceiptRow): ReceiptListRow {
  const file = data.files.find((f) => f.id === r.fileId);
  const staffName = (id: string | null) =>
    id ? (data.staff.find((x) => x.record.id === id)?.record.displayName ?? null) : null;
  return {
    id: r.id,
    uploadId: r.uploadId,
    staffId: r.staffId,
    staffName: staffName(r.staffId),
    customerId: r.customerId,
    customerDisplayName: r.customerId
      ? (data.customers.find((c) => c.id === r.customerId)?.displayName ?? null)
      : null,
    customerNameText: r.customerNameText,
    receiptedAt: new Date(r.receiptedAt),
    amountYen: r.amountYen,
    storeName: r.storeName,
    companyPaid: r.companyPaid,
    handoffText: data.uploads.find((u) => u.id === r.uploadId)?.handoffText ?? null,
    contentType: file?.contentType ?? 'application/octet-stream',
    byteSize: file?.byteSize ?? 0,
    cancelledAt: r.cancelledAt ? new Date(r.cancelledAt) : null,
    cancelledBy: r.cancelledBy,
    cancelledByName: staffName(r.cancelledBy),
    cancelReason: r.cancelReason,
    rowVersion: r.rowVersion,
  };
}

/** 全テナントのインメモリの DB。 */
export class MemoryDatabase {
  readonly tenants = new Map<string, TenantRecord>();
  readonly data = new Map<string, TenantData>();
  /** テナント → カレンダーの設定(platform.tenants.calendar_settings)。 */
  readonly calendarSettings = new Map<string, TenantCalendarSettings>();
  /** テナント → 顧客データの取込元の設定(platform.tenants.customer_import_settings。無ければ未設定)。 */
  readonly customerImportSettings = new Map<string, TenantCustomerImportSettings>();
  /** UoW の outboxPolicy と同じ(null なら全てのトピックを積む)。 */
  outboxPolicy: OutboxTopicPolicy | null = null;
  /** 顧客の取込のロック(importRuns.lockTenantCustomerImports)を取ったテナント(呼んだ順)。 */
  readonly customerImportLocks: string[] = [];
  /** GAS版からの取込のロック(legacyImports.lockTenantLegacyImports)を取ったテナント(呼んだ順)。 */
  readonly legacyImportLocks: string[] = [];
  private seq = 0;

  addTenant(input: Partial<TenantRecord> & { slug: string }): TenantRecord {
    const tenant: TenantRecord = {
      id: input.id ?? `00000000-0000-7000-8000-${String(++this.seq).padStart(12, '0')}`,
      name: input.name ?? input.slug,
      slug: input.slug,
      status: input.status ?? 'active',
      timezone: input.timezone ?? 'Asia/Tokyo',
      businessType: input.businessType ?? 'babysitting',
    };
    this.tenants.set(tenant.id, tenant);
    this.data.set(tenant.id, emptyTenantData());
    return tenant;
  }

  of(tenantId: string): TenantData {
    const data = this.data.get(tenantId);
    if (!data) throw new Error(`テナントがありません: ${tenantId}`);
    return data;
  }
}

// ─────────────────────────────────────────────────────────────
// UoW とリポジトリ
// ─────────────────────────────────────────────────────────────

export class FakeUnitOfWork implements UnitOfWorkPort {
  /** run が呼ばれた回数(トランザクションの数)。 */
  runs = 0;

  constructor(readonly db: MemoryDatabase) {}

  async run<T>(tenantId: string, work: (repos: TenantRepositories) => Promise<T>): Promise<T> {
    this.runs++;
    // 存在しないテナント(書き換えられた Cookie 等)は、RLS と同じく何も見えない空のデータとして扱う
    if (!this.db.data.has(tenantId)) return work(fakeRepositories(this.db, tenantId, emptyTenantData()));
    const snapshot = structuredClone(this.db.of(tenantId));
    try {
      return await work(fakeRepositories(this.db, tenantId));
    } catch (error) {
      this.db.data.set(tenantId, snapshot);
      throw error;
    }
  }
}

function staffRecordOf(row: StaffRow): StaffRecord {
  return structuredClone(row.record);
}

export function fakeRepositories(
  db: MemoryDatabase,
  tenantId: string,
  detached?: TenantData,
): TenantRepositories {
  const d = () => detached ?? db.of(tenantId);
  const staffById = (id: string) => d().staff.find((s) => s.record.id === id);
  /** AIプロンプトの次の版(DB と同じく履歴の最大値から数え、期待した版と違えば conflict)。 */
  const nextPromptRevision = (key: string, expectedRevision: number | undefined) => {
    const latest = d().aiPromptRevisions[key] ?? 0;
    if (expectedRevision !== undefined && latest !== expectedRevision) {
      throw conflict(STALE_PROMPT_MESSAGE, undefined, 'stale_revision');
    }
    return latest + 1;
  };
  const assertEmailFree = (email: string, selfId: string | null) => {
    const owner = d().staff.find((s) => s.record.email === email || s.record.altEmail === email);
    if (owner && owner.record.id !== selfId) {
      throw conflict(
        'このメールアドレスは他のスタッフが使用しています',
        undefined,
        'staff_login_emails_pkey',
      );
    }
  };
  const attendanceRows = (staffId: string, date: string): AttendanceDayRows => {
    const data = d();
    const strip = <T extends { staffId: string; businessDate: string }>({
      staffId: _s,
      businessDate: _b,
      ...rest
    }: T) => structuredClone(rest);
    return {
      staffId,
      businessDate: date,
      day: structuredClone(data.days.find((x) => x.staffId === staffId && x.businessDate === date) ?? null),
      visits: data.visits
        .filter((v) => v.staffId === staffId && v.businessDate === date)
        .sort((a, b) => a.seq - b.seq)
        .map(strip) as VisitRow[],
      segments: data.segments
        .filter((s) => s.staffId === staffId && s.businessDate === date)
        .map(strip) as WorkSegmentRow[],
      legs: data.legs
        .filter((l) => l.staffId === staffId && l.businessDate === date)
        .map(strip) as TravelLegRow[],
    };
  };
  const assertPeriodOpen = (staffId: string, date: string) => {
    if (d().lockedPeriods.some((p) => p.staffId === staffId && p.yearMonth === date.slice(0, 7))) {
      throw new DomainError(
        'locked',
        'この月の勤怠は締め済みのため変更できません。',
        undefined,
        'period_locked',
      );
    }
  };

  const attendance: AttendanceRepository = {
    async loadDay(staffId, businessDate) {
      return attendanceRows(staffId, businessDate);
    },
    async lockDay(staffId, businessDate, newDayId) {
      const data = d();
      let existed = true;
      if (!data.days.some((x) => x.staffId === staffId && x.businessDate === businessDate)) {
        assertPeriodOpen(staffId, businessDate);
        data.days.push({
          id: newDayId,
          staffId,
          businessDate,
          shoppingErrandCount: null,
          remarks: null,
          overriddenFields: [],
          rowVersion: 1,
        });
        existed = false;
      }
      const rows = attendanceRows(staffId, businessDate) as AttendanceDayRows & { day: AttendanceDayRow };
      return { ...rows, existed };
    },
    async loadRange(staffId, fromDate, toDate) {
      const data = d();
      const dates = new Set(
        [...data.days, ...data.visits, ...data.segments, ...data.legs]
          .filter((x) => x.staffId === staffId && x.businessDate >= fromDate && x.businessDate <= toDate)
          .map((x) => x.businessDate),
      );
      return [...dates].sort().map((date) => attendanceRows(staffId, date));
    },
    async findDayById(dayId) {
      const day = d().days.find((x) => x.id === dayId);
      return day ? attendanceRows(day.staffId, day.businessDate) : null;
    },
    async writeDay(dayId, write: AttendanceDayWrite, expectedVersion) {
      const data = d();
      const day = data.days.find((x) => x.id === dayId);
      if (!day || (expectedVersion !== undefined && day.rowVersion !== expectedVersion)) {
        throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
      }
      assertPeriodOpen(day.staffId, day.businessDate);
      Object.assign(day, structuredClone(write.day), { rowVersion: day.rowVersion + 1 });
      const own = { staffId: day.staffId, businessDate: day.businessDate };
      const apply = <T extends { id: string }>(
        list: (T & typeof own)[],
        change: { insert: T[]; update: T[]; delete: string[] },
      ) => {
        const kept = list.filter((x) => !change.delete.includes(x.id));
        for (const u of change.update) {
          const i = kept.findIndex((x) => x.id === u.id);
          if (i >= 0) kept[i] = { ...structuredClone(u), ...own };
        }
        for (const n of change.insert) kept.push({ ...structuredClone(n), ...own });
        return kept;
      };
      data.visits = apply(data.visits, write.visits);
      data.segments = apply(data.segments, write.segments);
      data.legs = apply(data.legs, write.legs);
      return structuredClone(day);
    },
    async lockPeriod(staffId, yearMonth) {
      d().lockedPeriods.push({ staffId, yearMonth });
    },
    async listLockedStaffIds(yearMonth) {
      return d()
        .lockedPeriods.filter((p) => p.yearMonth === yearMonth)
        .map((p) => p.staffId);
    },
    async isPeriodLocked(staffId, yearMonth) {
      return d().lockedPeriods.some((p) => p.staffId === staffId && p.yearMonth === yearMonth);
    },
  };

  return {
    tenantId,
    async tenant() {
      const tenant = db.tenants.get(tenantId);
      if (!tenant) throw new Error('テナントがありません');
      return tenant;
    },
    async calendarSettings() {
      return structuredClone(db.calendarSettings.get(tenantId) ?? EMPTY_CALENDAR_SETTINGS);
    },
    async customerImportSettings() {
      return structuredClone(db.customerImportSettings.get(tenantId) ?? null);
    },
    staff: {
      async findById(id) {
        const row = staffById(id);
        return row ? staffRecordOf(row) : null;
      },
      async findByLoginEmail(email) {
        const row = d().staff.find((s) => s.record.email === email || s.record.altEmail === email);
        return row ? staffRecordOf(row) : null;
      },
      async listAll() {
        return d().staff.map(staffRecordOf);
      },
      async listActiveOn(date) {
        return d()
          .staff.filter((s) => !s.record.retiredOn || s.record.retiredOn > date)
          .map(staffRecordOf);
      },
      async create(input: NewStaffInput) {
        assertEmailFree(input.email, null);
        if (input.altEmail) assertEmailFree(input.altEmail, null);
        const record: StaffRecord = {
          id: input.id,
          displayName: input.displayName,
          familyName: input.familyName,
          givenName: input.givenName,
          familyNameKana: input.familyNameKana ?? null,
          givenNameKana: input.givenNameKana ?? null,
          email: input.email,
          altEmail: input.altEmail ?? null,
          phone: input.phone ?? null,
          role: input.role,
          retiredOn: input.retiredOn ?? null,
          gender: input.gender ?? null,
          homeAddress: input.home?.address ?? null,
          homeGeo: input.home?.geo ?? null,
          travelMode: input.travelMode ?? null,
          rowVersion: 1,
        };
        d().staff.push({
          record,
          credentials: {
            passwordHash: input.passwordHash ?? null,
            legacyPasswordHash: input.legacyPasswordHash ?? null,
            failedCount: 0,
            lockedUntil: null,
          },
          homeGeoCell: input.home?.geoCell ?? null,
        });
        return structuredClone(record);
      },
      async update(id, patch, expectedVersion) {
        const row = staffById(id);
        if (!row) return null;
        if (expectedVersion !== undefined && row.record.rowVersion !== expectedVersion) {
          throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
        }
        if (patch.email) assertEmailFree(patch.email, id);
        if (patch.altEmail) assertEmailFree(patch.altEmail, id);
        const { home, ...columns } = patch;
        Object.assign(row.record, columns, { rowVersion: row.record.rowVersion + 1 });
        if (home) {
          Object.assign(row.record, { homeAddress: home.address, homeGeo: home.geo });
          row.homeGeoCell = home.geoCell;
        }
        return staffRecordOf(row);
      },
      async releaseLoginEmails(staffIds) {
        for (const id of staffIds) {
          const row = staffById(id);
          if (row) Object.assign(row.record, { email: '', altEmail: null });
        }
      },
      async lockActiveAdmins(date) {
        return d()
          .staff.filter(
            (s) => s.record.role === 'admin' && (!s.record.retiredOn || s.record.retiredOn > date),
          )
          .map((s) => ({ id: s.record.id, retiredOn: s.record.retiredOn }))
          .sort((a, b) => a.id.localeCompare(b.id));
      },
      async listPasswordStatuses() {
        return new Map(
          d().staff.map(
            (s) =>
              [
                s.record.id,
                s.credentials.passwordHash ? 'set' : s.credentials.legacyPasswordHash ? 'legacy' : 'unset',
              ] as const,
          ),
        );
      },
      async deleteIfUnreferenced(id) {
        if (!staffById(id)) return 'not_found';
        const data = d();
        // DB の外部キー(ON DELETE の無い参照)と同じく、業務の記録があれば消さない
        const referenced =
          data.entityChanges.some((x) => x.changedBy === id) ||
          data.careRecordRevisions.some((x) => x.changedBy === id) ||
          data.aiPromptRevisionAuthors.includes(id) ||
          data.days.some((x) => x.staffId === id) ||
          data.careRecords.some((x) => x.authorStaffId === id) ||
          data.receipts.some((x) => x.staffId === id) ||
          data.uploads.some((x) => x.staffId === id);
        if (referenced) return 'referenced';
        data.staff = data.staff.filter((s) => s.record.id !== id);
        data.sessions = data.sessions.filter((s) => s.staffId !== id);
        data.resetCodes = data.resetCodes.filter((c) => c.staffId !== id);
        data.calendars = data.calendars.filter((c) => c.staffId !== id);
        return 'deleted';
      },
      async getCredentials(staffId) {
        const row = staffById(staffId);
        return row
          ? {
              passwordHash: row.credentials.passwordHash,
              legacyPasswordHash: row.credentials.legacyPasswordHash,
            }
          : null;
      },
      async setPasswordHash(staffId, passwordHash) {
        const row = staffById(staffId);
        if (row)
          Object.assign(row.credentials, {
            passwordHash,
            legacyPasswordHash: null,
            failedCount: 0,
            lockedUntil: null,
          });
      },
      async setLegacyPasswordHash(staffId, legacyPasswordHash) {
        const row = staffById(staffId);
        if (row && !row.credentials.passwordHash) row.credentials.legacyPasswordHash = legacyPasswordHash;
      },
      async recordLoginFailure(staffId, lockedUntil) {
        const row = staffById(staffId);
        if (row) {
          row.credentials.failedCount++;
          if (lockedUntil) row.credentials.lockedUntil = lockedUntil;
        }
      },
      async recordLoginSuccess(staffId) {
        const row = staffById(staffId);
        if (row) Object.assign(row.credentials, { failedCount: 0, lockedUntil: null });
      },
      async listRouteProfiles() {
        return d().staff.map((s) => ({
          id: s.record.id,
          displayName: s.record.displayName,
          homeAddress: s.record.homeAddress,
          homeGeo: s.record.homeGeo,
          travelMode: s.record.travelMode,
          scheduleCalendarId:
            d().calendars.find((c) => c.staffId === s.record.id && c.purpose === 'schedule')?.calendarId ??
            null,
          retiredOn: s.record.retiredOn,
        }));
      },
    },
    sessions: {
      async create(input) {
        d().sessions.push({ ...input, lastSeenAt: input.createdAt, revokedAt: null });
      },
      async findByTokenHash(tokenHash) {
        const s = d().sessions.find((x) => sameBytes(x.tokenHash, tokenHash));
        if (!s) return null;
        const { tokenHash: _t, ...record } = s;
        return structuredClone(record);
      },
      async touch(id, lastSeenAt, idleExpiresAt) {
        const s = d().sessions.find((x) => x.id === id);
        if (s) Object.assign(s, { lastSeenAt, idleExpiresAt });
      },
      async revoke(id, at) {
        const s = d().sessions.find((x) => x.id === id && !x.revokedAt);
        if (s) s.revokedAt = at;
      },
      async revokeAllForStaff(staffId, at, exceptId) {
        for (const s of d().sessions)
          if (s.staffId === staffId && s.id !== exceptId && !s.revokedAt) s.revokedAt = at;
      },
    },
    passwordResetCodes: {
      async replaceActive(input, now) {
        for (const c of d().resetCodes) {
          if (c.staffId === input.staffId && !c.usedAt) Object.assign(c, { usedAt: now, mailCode: null });
        }
        const record: PasswordResetCodeRecord = { ...input, usedAt: null, attemptCount: 0 };
        d().resetCodes.push(record);
        return structuredClone(record);
      },
      async findLatestUnused(staffId) {
        const found = d()
          .resetCodes.filter((c) => c.staffId === staffId && !c.usedAt)
          .at(-1);
        return found ? structuredClone(found) : null;
      },
      async findById(id) {
        const found = d().resetCodes.find((c) => c.id === id);
        return found ? structuredClone(found) : null;
      },
      async registerAttempt(id, now) {
        const c = d().resetCodes.find((x) => x.id === id);
        if (!c || c.usedAt || c.expiresAt <= now || c.attemptCount >= c.maxAttempts) return null;
        c.attemptCount++;
        return structuredClone(c);
      },
      async consume(id, now) {
        const c = d().resetCodes.find((x) => x.id === id);
        if (!c || c.usedAt) return false;
        Object.assign(c, { usedAt: now, mailCode: null });
        return true;
      },
      async markUsed(id, at) {
        const c = d().resetCodes.find((x) => x.id === id && !x.usedAt);
        if (c) Object.assign(c, { usedAt: at, mailCode: null });
      },
      async clearMailCode(id) {
        const c = d().resetCodes.find((x) => x.id === id);
        if (c) c.mailCode = null;
      },
    },
    customers: {
      async findById(id) {
        const c = d().customers.find((x) => x.id === id);
        return c ? structuredClone(c) : null;
      },
      async listActiveSummaries() {
        return d()
          .customers.filter((c) => !c.archivedAt)
          .map((c) => ({
            id: c.id,
            displayName: c.displayName,
            phone: c.phone,
            city: d().addresses.find((a) => a.customerId === c.id && a.kind === 'home')?.city ?? null,
          }));
      },
      async findByFamilyName(familyName) {
        return (await this.listActiveSummaries()).filter(
          (s) => d().customers.find((c) => c.id === s.id)?.familyName === familyName,
        );
      },
      async create(input) {
        const record: CustomerRecord = {
          familyNameKana: null,
          givenNameKana: null,
          email: null,
          phone: null,
          memo: null,
          benefitMemberId: null,
          evacuationSite: null,
          ...input,
          archivedAt: null,
          archiveReason: null,
          rowVersion: 1,
        };
        d().customers.push(record);
        return structuredClone(record);
      },
      async update(id, patch, expectedVersion) {
        const c = d().customers.find((x) => x.id === id);
        if (!c || (expectedVersion !== undefined && c.rowVersion !== expectedVersion)) {
          throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
        }
        Object.assign(c, patch, { rowVersion: c.rowVersion + 1 });
        return structuredClone(c);
      },
      async archive(id, reason, at) {
        const c = d().customers.find((x) => x.id === id && !x.archivedAt);
        if (c) Object.assign(c, { archivedAt: at, archiveReason: reason, rowVersion: c.rowVersion + 1 });
      },
      async unarchive(id) {
        const c = d().customers.find((x) => x.id === id && x.archivedAt);
        if (c) Object.assign(c, { archivedAt: null, archiveReason: null, rowVersion: c.rowVersion + 1 });
      },
    },
    customerSourceRecords: {
      async findByExternalId(source, externalId) {
        const r = d().sourceRecords.find((x) => x.source === source && x.externalId === externalId);
        return r ? structuredClone(r) : null;
      },
      async findByCustomerId(customerId) {
        const r = d().sourceRecords.find((x) => x.customerId === customerId);
        return r ? structuredClone(r) : null;
      },
      async mapExternalIds(source) {
        return new Map(
          d()
            .sourceRecords.filter((x) => x.source === source)
            .map((x) => [
              x.externalId,
              {
                customerId: x.customerId,
                archived: Boolean(d().customers.find((c) => c.id === x.customerId)?.archivedAt),
              },
            ]),
        );
      },
      async upsert(input) {
        const list = d().sourceRecords;
        const i = list.findIndex((x) => x.source === input.source && x.externalId === input.externalId);
        if (i >= 0) list[i] = { ...structuredClone(input), id: (list[i] as CustomerSourceRecord).id };
        else list.push(structuredClone(input));
      },
    },
    customerAddresses: {
      async listByCustomer(customerId) {
        return structuredClone(d().addresses.filter((a) => a.customerId === customerId));
      },
      async listForActiveCustomers() {
        const active = new Set(
          d()
            .customers.filter((c) => !c.archivedAt)
            .map((c) => c.id),
        );
        return structuredClone(d().addresses.filter((a) => active.has(a.customerId)));
      },
      async insert(input) {
        d().addresses.push(structuredClone(input));
      },
      async update(id, patch) {
        const a = d().addresses.find((x) => x.id === id);
        if (a) Object.assign(a, structuredClone(patch));
      },
      async delete(id) {
        d().addresses = d().addresses.filter((a) => a.id !== id);
      },
    },
    customerContacts: {
      async listByCustomer(customerId) {
        return structuredClone(d().contacts.filter((c) => c.customerId === customerId));
      },
      async insert(input) {
        d().contacts.push(structuredClone(input));
      },
      async update(id, patch) {
        const c = d().contacts.find((x) => x.id === id);
        if (c) Object.assign(c, structuredClone(patch));
      },
      async delete(id) {
        d().contacts = d().contacts.filter((c) => c.id !== id);
      },
    },
    careRecipients: {
      async listByCustomer(customerId, options = {}) {
        return structuredClone(
          d()
            .recipients.filter(
              (c) => c.customerId === customerId && (options.includeArchived || !c.archivedAt),
            )
            .sort((a, b) => a.sortOrder - b.sortOrder),
        );
      },
      async insert(input) {
        d().recipients.push({ ...structuredClone(input), archivedAt: null });
      },
      async update(id, patch) {
        const c = d().recipients.find((x) => x.id === id);
        if (c) Object.assign(c, structuredClone(patch));
      },
    },
    attendance,
    careRecords: {
      async findById(id) {
        const c = d().careRecords.find((x) => x.id === id);
        if (!c) return null;
        const { updatedAt: _updatedAt, createdAt: _createdAt, ...row } = c;
        return structuredClone(row);
      },
      async insert(input) {
        const now = new Date();
        const row: CareRecordRow & { updatedAt?: Date; createdAt?: Date } = {
          ...structuredClone(input),
          rowVersion: 1,
          updatedAt: now,
          createdAt: now,
        };
        d().careRecords.push(row);
        const { updatedAt: _updatedAt, createdAt: _createdAt, ...saved } = row;
        return structuredClone(saved);
      },
      async update(id, patch, expectedVersion) {
        const c = d().careRecords.find((x) => x.id === id);
        if (!c || (expectedVersion !== undefined && c.rowVersion !== expectedVersion)) {
          throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
        }
        // DB のトリガー(care_records_guard)と同じ: 確定済みは変更できず、下書き以外の本文の変更は履歴に残す
        if (c.status === 'locked') {
          throw new DomainError('locked', '確定済みの記録は変更できません。', undefined, 'record_locked');
        }
        const bodyChanged =
          (patch.body && JSON.stringify(patch.body) !== JSON.stringify(c.body)) ||
          (patch.bodySchemaVer !== undefined && patch.bodySchemaVer !== c.bodySchemaVer);
        if (bodyChanged && c.status !== 'draft') {
          d().careRecordRevisions.push({ careRecordId: id, body: structuredClone(c.body), changedBy: null });
        }
        Object.assign(c, structuredClone(patch), { rowVersion: c.rowVersion + 1, updatedAt: new Date() });
        const { updatedAt: _updatedAt, createdAt: _createdAt, ...saved } = c;
        return structuredClone(saved);
      },
      async listByCustomer(customerId, after, limit) {
        return structuredClone(
          d()
            .careRecords.filter((c) => c.customerId === customerId)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : -1))
            .filter(
              (c) =>
                !after ||
                c.occurredAt.getTime() < after.occurredAt.getTime() ||
                (c.occurredAt.getTime() === after.occurredAt.getTime() && c.id < after.id),
            )
            .slice(0, limit),
        );
      },
      async listByPeriod(filter, sort, after, limit) {
        const keyOf = (c: CareRecordListRow) => (sort === 'saved' ? c.createdAt : c.occurredAt).getTime();
        const afterAt = after ? new Date(after.at).getTime() : 0;
        return structuredClone(
          d()
            .careRecords.filter(
              (c) =>
                c.occurredAt.getTime() >= filter.from.getTime() &&
                c.occurredAt.getTime() < filter.to.getTime() &&
                (!filter.authorStaffId || c.authorStaffId === filter.authorStaffId) &&
                (!filter.customerId || c.customerId === filter.customerId) &&
                (!filter.recordTypes || filter.recordTypes.includes(c.recordType)),
            )
            .map(toCareRecordListRow)
            .sort((a, b) => keyOf(b) - keyOf(a) || (a.id < b.id ? 1 : -1))
            .filter((c) => !after || keyOf(c) < afterAt || (keyOf(c) === afterAt && c.id < after.id))
            .slice(0, limit),
        );
      },
      async findListRowById(id) {
        const c = d().careRecords.find((x) => x.id === id);
        return c ? structuredClone(toCareRecordListRow(c)) : null;
      },
      async countRevisions(id) {
        return d().careRecordRevisions.filter((x) => x.careRecordId === id).length;
      },
    },
    receipts: {
      async createUpload(input) {
        d().uploads.push(structuredClone(input));
      },
      async findUpload(id) {
        const u = d().uploads.find((x) => x.id === id);
        return u ? structuredClone(u) : null;
      },
      async insertIfNew(input) {
        // 部分UNIQUE と同じく、代表どうしで取消していない行とだけ重なりを確かめる
        if (
          input.dedupePrimary &&
          d().receipts.some(
            (r) => r.dedupePrimary && r.cancelledAt === null && sameBytes(r.dedupeHash, input.dedupeHash),
          )
        )
          return false;
        d().receipts.push({
          ...structuredClone(input),
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          rowVersion: 1,
        });
        return true;
      },
      async findActivePrimaryByDedupeHash(dedupeHash) {
        return (
          d().receipts.find(
            (r) => r.dedupePrimary && r.cancelledAt === null && sameBytes(r.dedupeHash, dedupeHash),
          )?.id ?? null
        );
      },
      async findById(id) {
        const r = d().receipts.find((x) => x.id === id);
        return r ? structuredClone(r) : null;
      },
      async isFirstOfUpload(receipt) {
        return (
          d()
            .receipts.filter((r) => r.uploadId === receipt.uploadId)
            .sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id === receipt.id
        );
      },
      async listActiveByStaffAndPeriod(staffId, from, to) {
        return structuredClone(
          d()
            .receipts.filter(
              (r) =>
                r.staffId === staffId &&
                r.receiptedAt >= from &&
                r.receiptedAt < to &&
                r.cancelledAt === null,
            )
            .sort((a, b) => a.receiptedAt.getTime() - b.receiptedAt.getTime()),
        );
      },
      async list(filter, after, limit) {
        return matchingReceipts(d(), filter)
          .filter((r) => filter.includeCancelled || r.cancelledAt === null)
          .filter(
            (r) =>
              !after ||
              r.receiptedAt.getTime() < after.receiptedAt.getTime() ||
              (r.receiptedAt.getTime() === after.receiptedAt.getTime() && r.id < after.id),
          )
          .slice(0, limit)
          .map((r) => receiptListRowOf(d(), r));
      },
      async findListRow(id) {
        const r = d().receipts.find((x) => x.id === id);
        return r ? receiptListRowOf(d(), r) : null;
      },
      async summarize(filter) {
        const all = matchingReceipts(d(), filter);
        const rows = all.filter((r) => r.cancelledAt === null);
        return {
          count: rows.length,
          totalYen: rows.reduce((sum, r) => sum + (r.amountYen ?? 0), 0),
          companyPaidYen: rows.reduce((sum, r) => sum + (r.companyPaid ? (r.amountYen ?? 0) : 0), 0),
          noAmountCount: rows.filter((r) => r.amountYen === null).length,
          cancelledCount: all.length - rows.length,
        };
      },
      async findImage(receiptId) {
        const r = d().receipts.find((x) => x.id === receiptId);
        const file = r ? d().files.find((f) => f.id === r.fileId) : undefined;
        if (!r || !file) return null;
        return {
          receiptId: r.id,
          staffId: r.staffId,
          storageKey: file.storageKey,
          contentType: file.contentType,
        };
      },
      async cancel(id, cancellation, expectedVersion) {
        const r = d().receipts.find((x) => x.id === id);
        if (!r || r.cancelledAt !== null || r.rowVersion !== expectedVersion) {
          throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
        }
        Object.assign(r, structuredClone(cancellation), { rowVersion: r.rowVersion + 1 });
        if (!r.dedupePrimary || !r.dedupeHash) return;
        // 代表を取消したら、同じ内容の取消していない行のうち最も古いものを代表にする(版は上げない)
        const next = d()
          .receipts.filter((x) => x.cancelledAt === null && sameBytes(x.dedupeHash, r.dedupeHash))
          .sort((a, b) => a.receiptedAt.getTime() - b.receiptedAt.getTime() || (a.id < b.id ? -1 : 1))[0];
        if (next) next.dedupePrimary = true;
      },
    },
    storedFiles: {
      async insert(input) {
        d().files.push(structuredClone(input));
      },
      async findById(id) {
        const f = d().files.find((x) => x.id === id);
        return f ? structuredClone(f) : null;
      },
      async listPage(afterId, limit) {
        const sorted = [...d().files].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return structuredClone(sorted.filter((f) => afterId === null || f.id > afterId).slice(0, limit));
      },
      async listUnreferenced() {
        return structuredClone(d().files.filter((f) => !d().receipts.some((r) => r.fileId === f.id)));
      },
      async delete(id) {
        d().files = d().files.filter((f) => f.id !== id);
      },
    },
    settings: {
      async get() {
        return structuredClone(d().settings);
      },
      async bumpCustomerDataVersion() {
        return ++d().settings.customerDataVersion;
      },
    },
    secrets: {
      async get(name) {
        const s = d().secrets.find((x) => x.name === name);
        return s ? structuredClone(s) : null;
      },
      async put(name, sealedValue) {
        d().secrets = [
          ...d().secrets.filter((x) => x.name !== name),
          { name, sealedValue, rotatedAt: new Date() },
        ];
      },
    },
    aiPrompts: {
      async listAll() {
        return structuredClone(d().aiPrompts);
      },
      async findByKey(key) {
        const p = d().aiPrompts.find((x) => x.key === key);
        return p ? structuredClone(p) : null;
      },
      async latestRevisions() {
        return new Map(Object.entries(d().aiPromptRevisions));
      },
      async save({ expectedRevision, ...input }) {
        const revision = nextPromptRevision(input.key, expectedRevision);
        d().aiPromptRevisions[input.key] = revision;
        d().aiPromptRevisionAuthors.push(input.updatedBy);
        d().aiPrompts = [
          ...d().aiPrompts.filter((x) => x.key !== input.key),
          { ...input, revision, updatedAt: new Date() },
        ];
      },
      async reset(key, updatedBy, expectedRevision) {
        const revision = nextPromptRevision(key, expectedRevision);
        if (!d().aiPrompts.some((x) => x.key === key)) return;
        d().aiPromptRevisions[key] = revision;
        d().aiPromptRevisionAuthors.push(updatedBy);
        d().aiPrompts = d().aiPrompts.filter((x) => x.key !== key);
      },
    },
    appLogs: {
      async list(filter, page) {
        const before = (x: AppLogRecord) =>
          !page.after ||
          x.position.at < page.after.at ||
          (x.position.at === page.after.at && x.id < page.after.id);
        return d()
          .appLogs.filter(
            (x) =>
              x.createdAt >= filter.from &&
              x.createdAt < filter.to &&
              (!filter.level || x.level === filter.level) &&
              (!filter.staffId || x.actorStaffId === filter.staffId || x.targetStaffId === filter.staffId) &&
              (!filter.actionPrefix || x.action.startsWith(filter.actionPrefix)) &&
              before(x),
          )
          .sort((a, b) => b.position.at.localeCompare(a.position.at) || b.id.localeCompare(a.id))
          .slice(0, page.limit)
          .map((x) => structuredClone(x));
      },
    },
    importRuns: {
      async lockTenantCustomerImports() {
        // メモリの UoW は並んで走らないため、取ったことだけを残す
        db.customerImportLocks.push(tenantId);
      },
      async start(input) {
        d().importRuns.push({
          id: input.id,
          source: input.source,
          fileName: input.fileName,
          fileVersion: input.fileVersion,
          status: 'running',
          counts: {},
          startedAt: new Date(),
          finishedAt: null,
          message: null,
        });
      },
      async finish(id, result) {
        const run = d().importRuns.find((x) => x.id === id);
        if (run) Object.assign(run, result, { finishedAt: new Date() });
      },
      async latestApplied(source) {
        const run = d()
          .importRuns.filter((x) => x.source === source && x.status === 'applied')
          .at(-1);
        return run ? structuredClone(run) : null;
      },
      async latestFinished(source) {
        const run = d()
          .importRuns.filter((x) => x.source === source && x.status !== 'running')
          .at(-1);
        return run ? structuredClone(run) : null;
      },
    },
    legacyImports: {
      async lockTenantLegacyImports() {
        db.legacyImportLocks.push(tenantId);
      },
      async findByRowNumbers(source, rowNumbers) {
        const numbers = new Set(rowNumbers);
        return structuredClone(
          d()
            .legacyImportedRows.filter((x) => x.source === source && numbers.has(x.rowNumber))
            .map(({ importRunId: _run, ...row }) => row),
        );
      },
      async findBySourceKeys(source, sourceKeys) {
        const keys = new Set(sourceKeys);
        return structuredClone(
          d()
            .legacyImportedRows.filter((x) => x.source === source && keys.has(x.sourceKey))
            .map(({ importRunId: _run, ...row }) => row),
        );
      },
      async listBySource(source) {
        return structuredClone(
          d()
            .legacyImportedRows.filter((x) => x.source === source)
            .map(({ importRunId: _run, ...row }) => row),
        );
      },
      async save(row) {
        const existing = d().legacyImportedRows.find(
          (x) => x.source === row.source && x.rowNumber === row.rowNumber,
        );
        if (existing) {
          Object.assign(existing, {
            sourceKey: row.sourceKey,
            sourceDigest: row.sourceDigest,
            syncedRowVersion: row.syncedRowVersion,
            importRunId: row.importRunId,
          });
          return;
        }
        // 実際の DB の一意の索引と同じく、領収書の同じ画像は1行だけ
        if (
          row.source === 'gas_receipt' &&
          d().legacyImportedRows.some((x) => x.source === 'gas_receipt' && x.sourceKey === row.sourceKey)
        ) {
          throw new Error('legacy_imported_rows_tenant_id_receipt_source_key_key');
        }
        d().legacyImportedRows.push(structuredClone(row));
      },
      async isImportedReceipt(receiptId) {
        return d().legacyImportedRows.some((x) => x.receiptId === receiptId);
      },
    },
    integrationApiKeys: {
      async create(input) {
        const row = {
          ...structuredClone(input),
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
        };
        d().integrationApiKeys.push(row);
        const { tokenHash: _hash, ...record } = row;
        return structuredClone(record);
      },
      async list() {
        return [...d().integrationApiKeys]
          .reverse()
          .map(({ tokenHash: _hash, ...record }) => structuredClone(record));
      },
      async findByTokenHash(tokenHash) {
        const found = d().integrationApiKeys.find((k) => sameBytes(k.tokenHash, tokenHash));
        if (!found) return null;
        const { tokenHash: _hash, ...record } = found;
        return structuredClone(record);
      },
      async touch(id, at) {
        const found = d().integrationApiKeys.find((k) => k.id === id);
        if (found) found.lastUsedAt = at;
      },
      async revoke(id, at) {
        const found = d().integrationApiKeys.find((k) => k.id === id && k.revokedAt === null);
        if (!found) return false;
        found.revokedAt = at;
        return true;
      },
    },
    staffCalendars: {
      async listAll() {
        return structuredClone(d().calendars);
      },
      async setScheduleCalendar(staffId, calendarId, newId) {
        d().calendars = d().calendars.filter((c) => !(c.staffId === staffId && c.purpose === 'schedule'));
        if (calendarId) d().calendars.push({ id: newId, staffId, calendarId, purpose: 'schedule' });
      },
      async recordSync() {},
    },
    busyBlocks: {
      async replaceInWindow(staffId, _source, window, blocks) {
        d().busyBlocks = [
          ...d().busyBlocks.filter(
            (b) => b.staffId !== staffId || b.end <= window.from || b.start >= window.to,
          ),
          ...blocks.map((b) => ({ staffId, start: b.period.start, end: b.period.end })),
        ];
      },
    },
    reservations: {
      async create(input) {
        d().reservations.push(structuredClone(input));
      },
      async listConfirmedVisitsForStaffOnDate(staffId, businessDate) {
        const data = d();
        return data.reservations
          .filter((r) => r.businessDate === businessDate && r.assignments.some((a) => a.staffId === staffId))
          .map((r) => ({
            reservationId: r.id,
            customerId: r.customerId,
            customerDisplayName: data.customers.find((c) => c.id === r.customerId)?.displayName ?? '',
            start: new Date(r.period.start),
            end: new Date(r.period.end),
          }))
          .sort(
            (a, b) => a.start.getTime() - b.start.getTime() || (a.reservationId < b.reservationId ? -1 : 1),
          );
      },
    },
    pushSubscriptions: {
      async findById(id) {
        return structuredClone(d().pushSubscriptions.find((p) => p.id === id) ?? null);
      },
      async findByEndpoint(endpoint) {
        return structuredClone(d().pushSubscriptions.find((p) => p.endpoint === endpoint) ?? null);
      },
      async upsert(input) {
        const data = d();
        const existing = data.pushSubscriptions.find((p) => p.endpoint === input.endpoint);
        if (existing) {
          Object.assign(existing, {
            staffId: input.staffId,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
            failureCount: 0,
            updatedAt: touchedAt(),
          });
          return structuredClone(existing);
        }
        const created: PushSubscriptionRecord = {
          ...input,
          createdAt: new Date(),
          updatedAt: touchedAt(),
          lastSuccessAt: null,
          failureCount: 0,
        };
        data.pushSubscriptions.push(created);
        return structuredClone(created);
      },
      async trimForStaff(staffId, keep) {
        const data = d();
        const own = data.pushSubscriptions
          .filter((p) => p.staffId === staffId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        const removed = new Set(own.slice(keep));
        data.pushSubscriptions = data.pushSubscriptions.filter((p) => !removed.has(p));
        return removed.size;
      },
      async deleteForStaff(staffId, endpoint) {
        const data = d();
        const found = data.pushSubscriptions.find((p) => p.staffId === staffId && p.endpoint === endpoint);
        if (!found) return null;
        data.pushSubscriptions = data.pushSubscriptions.filter((p) => p !== found);
        return found.id;
      },
      async deleteAllForStaff(staffId) {
        const before = d().pushSubscriptions.length;
        d().pushSubscriptions = d().pushSubscriptions.filter((p) => p.staffId !== staffId);
        return before - d().pushSubscriptions.length;
      },
      async listForStaff(staffId) {
        return structuredClone(d().pushSubscriptions.filter((p) => p.staffId === staffId));
      },
      async listSubscribedStaffIds() {
        return [...new Set(d().pushSubscriptions.map((p) => p.staffId))];
      },
      async recordSuccess(id, at) {
        const found = d().pushSubscriptions.find((p) => p.id === id);
        if (found) Object.assign(found, { lastSuccessAt: at, failureCount: 0, updatedAt: touchedAt() });
      },
      async recordRetryableFailure(id) {
        const found = d().pushSubscriptions.find((p) => p.id === id);
        if (found) found.updatedAt = touchedAt();
      },
      async recordRejection(id) {
        const found = d().pushSubscriptions.find((p) => p.id === id);
        if (!found) return 0;
        found.failureCount++;
        found.updatedAt = touchedAt();
        return found.failureCount;
      },
      async delete(id) {
        d().pushSubscriptions = d().pushSubscriptions.filter((p) => p.id !== id);
      },
    },
    outbox: {
      async enqueue(message) {
        const slug = async () => db.tenants.get(tenantId)?.slug ?? '';
        if (db.outboxPolicy && !(await isOutboxTopicEnabled(db.outboxPolicy, message.topic, slug)))
          return false;
        if (d().outbox.some((m) => m.dedupeKey === message.dedupeKey)) return false;
        d().outbox.push({
          ...structuredClone(message),
          id: `msg-${d().outbox.length + 1}`,
          tenantId,
          status: 'pending',
          attempts: 0,
          maxAttempts: 8,
          availableAt: new Date(0),
          lockedUntil: null,
          lockedBy: null,
          lastError: null,
          completedAt: null,
        });
        return true;
      },
      async latestPayload(topic, aggregateId) {
        const last = d()
          .outbox.filter((m) => m.topic === topic && m.aggregateId === aggregateId)
          .at(-1);
        return last ? structuredClone(last.payload ?? {}) : null;
      },
    },
    entityChanges: {
      async append(change) {
        d().entityChanges.push(structuredClone(change));
      },
    },
    retention: {
      async purge() {
        return {};
      },
    },
    ...fakeReportAiRepositories(d),
  };
}

/** ワーカー側の outbox(MemoryDatabase の全テナントから取り出す)。 */
export class FakeOutboxQueue implements OutboxQueuePort {
  constructor(private readonly db: MemoryDatabase) {}

  private all(): OutboxRow[] {
    return [...this.db.data.values()].flatMap((d) => d.outbox);
  }

  private find(id: string, tenantId: string): OutboxRow | undefined {
    return this.db.of(tenantId).outbox.find((m) => m.id === id);
  }

  async claimNext(workerId: string, leaseMs: number, now: Date): Promise<ClaimedOutboxMessage | null> {
    const next = this.all().find(
      (m) =>
        (m.status === 'pending' && m.availableAt <= now) ||
        (m.status === 'processing' &&
          m.lockedUntil !== null &&
          m.lockedUntil < now &&
          m.attempts < m.maxAttempts),
    );
    if (!next) return null;
    Object.assign(next, {
      status: 'processing',
      attempts: next.attempts + 1,
      lockedUntil: new Date(now.getTime() + leaseMs),
      lockedBy: workerId,
    });
    return {
      id: next.id,
      tenantId: next.tenantId,
      topic: next.topic,
      aggregateType: next.aggregateType,
      aggregateId: next.aggregateId,
      payload: next.payload ?? {},
      attempts: next.attempts,
      maxAttempts: next.maxAttempts,
      lockedBy: workerId,
    };
  }

  async expireExhaustedLeases(now: Date, error: string): Promise<ExpiredOutboxMessage[]> {
    const expired = this.all().filter(
      (m) =>
        m.status === 'processing' &&
        m.lockedUntil !== null &&
        m.lockedUntil < now &&
        m.attempts >= m.maxAttempts,
    );
    for (const m of expired) {
      Object.assign(m, {
        status: 'dead',
        lockedUntil: null,
        lockedBy: null,
        lastError: error,
        completedAt: now,
      });
    }
    return expired.map((m) => ({
      id: m.id,
      tenantId: m.tenantId,
      topic: m.topic,
      aggregateId: m.aggregateId,
      attempts: m.attempts,
    }));
  }

  /** 取り出したときのリースのままなら書く(DrizzleOutboxQueue と同じ条件)。 */
  private finish(lease: ClaimedOutboxMessage, values: Partial<OutboxRow>): boolean {
    const m = this.find(lease.id, lease.tenantId);
    const held = m?.status === 'processing' && m.lockedBy === lease.lockedBy && m.attempts === lease.attempts;
    if (!m || !held) return false;
    Object.assign(m, { lockedUntil: null, lockedBy: null, ...values });
    return true;
  }

  async complete(lease: ClaimedOutboxMessage, now: Date): Promise<boolean> {
    return this.finish(lease, { status: 'done', completedAt: now, lastError: null });
  }

  async retry(lease: ClaimedOutboxMessage, error: string, availableAt: Date): Promise<boolean> {
    return this.finish(lease, { status: 'pending', lastError: error, availableAt });
  }

  async giveUp(
    lease: ClaimedOutboxMessage,
    error: string,
    status: 'failed' | 'dead',
    now: Date,
  ): Promise<boolean> {
    return this.finish(lease, { status, lastError: error, completedAt: now });
  }
}

export class FakeTenantCalendarSettingsStore implements TenantCalendarSettingsStore {
  constructor(private readonly db: MemoryDatabase) {}
  async get(tenantId: string) {
    return structuredClone(this.db.calendarSettings.get(tenantId) ?? EMPTY_CALENDAR_SETTINGS);
  }
  async set(tenantId: string, settings: TenantCalendarSettings) {
    this.db.calendarSettings.set(tenantId, structuredClone(settings));
  }
}

export class FakeTenantCustomerImportSettingsStore implements TenantCustomerImportSettingsStore {
  constructor(private readonly db: MemoryDatabase) {}
  async get(tenantId: string) {
    return structuredClone(this.db.customerImportSettings.get(tenantId) ?? null);
  }
  async findTenantIdsByDriveFolder(driveFolderId: string) {
    return [...this.db.customerImportSettings]
      .filter(([, settings]) => settings.driveFolderId === driveFolderId)
      .map(([tenantId]) => tenantId);
  }
  async set(tenantId: string, settings: TenantCustomerImportSettings | null) {
    if (settings) this.db.customerImportSettings.set(tenantId, structuredClone(settings));
    else this.db.customerImportSettings.delete(tenantId);
  }
}

export class FakeTenantDirectory implements TenantDirectoryPort {
  constructor(private readonly db: MemoryDatabase) {}
  async findBySlug(slug: string) {
    return [...this.db.tenants.values()].find((t) => t.slug === slug) ?? null;
  }
  async findById(id: string) {
    return this.db.tenants.get(id) ?? null;
  }
  async listActive() {
    return [...this.db.tenants.values()].filter((t) => t.status === 'active');
  }
  async listAll() {
    return [...this.db.tenants.values()];
  }
}

export class FakeTenantProvisioning implements TenantProvisioningPort {
  readonly provisioned: ProvisionTenantInput[] = [];
  constructor(private readonly db: MemoryDatabase) {}
  async provision(input: ProvisionTenantInput) {
    this.provisioned.push(input);
    this.db.addTenant({ id: input.id, slug: input.slug, name: input.name, timezone: input.timezone });
  }
}

// ─────────────────────────────────────────────────────────────
// 外部サービス
// ─────────────────────────────────────────────────────────────

/**
 * 暗号文の代わりに `SEALED|テナントID|名前|平文` を返す。テナント・名前が違えば本物と同じく開けない
 * (テストは保存された値が平文でないことも確かめられる)。
 */
export class FakeSecretBox implements SecretBoxPort {
  /** true にすると open が例外を投げる(鍵・プロバイダを変えて開けなくなった状態を再現する)。 */
  failOpen = false;

  async seal(tenantId: string, name: TenantSecretName, plaintext: string): Promise<Uint8Array> {
    return Buffer.from(`SEALED|${tenantId}|${name}|${plaintext}`, 'utf8');
  }
  async open(tenantId: string, name: TenantSecretName, sealed: Uint8Array): Promise<string> {
    if (this.failOpen) throw new Error('秘密値を開けません(鍵が違います)');
    const prefix = `SEALED|${tenantId}|${name}|`;
    const text = Buffer.from(sealed).toString('utf8');
    if (!text.startsWith(prefix)) throw new Error(`秘密値を開けません(テナント・名前が違います): ${name}`);
    return text.slice(prefix.length);
  }
}

export class FakeNotifierPort implements NotifierPort {
  readonly notifications: { tenantId: string; channel: NotificationChannel; text: string }[] = [];
  result: NotifyResult = { status: 'sent' };

  async notify(tenantId: string, channel: NotificationChannel, text: string): Promise<NotifyResult> {
    this.notifications.push({ tenantId, channel, text });
    return this.result;
  }
}

export class FakeAppLogPort implements AppLogPort {
  readonly entries: AppLogEntry[] = [];
  private seq = 0;

  /** db を渡すと、テナントのある記録を操作ログの閲覧(r.appLogs)でも読めるように残す。 */
  constructor(
    private readonly db?: MemoryDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async write(entry: AppLogEntry): Promise<void> {
    this.entries.push(entry);
    if (!entry.tenantId || !this.db?.data.has(entry.tenantId)) return;
    const createdAt = this.now();
    const id = `00000000-0000-7000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.db.of(entry.tenantId).appLogs.push({
      id,
      createdAt,
      position: { at: createdAt.toISOString(), id },
      level: entry.level,
      action: entry.action,
      actorType: entry.actorStaffId ? 'staff' : (entry.actorType ?? 'system'),
      actorStaffId: entry.actorStaffId ?? null,
      targetStaffId: entry.targetStaffId ?? null,
      details: structuredClone(entry.details ?? {}),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
    });
  }

  actions(): string[] {
    return this.entries.map((e) => e.action);
  }

  /** 指定 action のログだけを返す。 */
  byAction(action: string): AppLogEntry[] {
    return this.entries.filter((e) => e.action === action);
  }
}

export class FakeMailerPort implements MailerPort {
  readonly sent: MailMessage[] = [];
  fail = false;

  async send(message: MailMessage): Promise<void> {
    if (this.fail) throw new Error('SMTP送信エラー(テスト)');
    this.sent.push(message);
  }
}

export class FakeRateLimiter implements RateLimiterPort {
  readonly buckets = new Map<string, RateLimitBucket>();

  private keyOf(rule: RateLimitRule, key: string): string {
    return `${rule.name}|${key}`;
  }
  async consume(rule: RateLimitRule, key: string, now: Date): Promise<RateLimitDecision> {
    const { bucket, decision } = consumeRateLimit(this.buckets.get(this.keyOf(rule, key)) ?? null, rule, now);
    this.buckets.set(this.keyOf(rule, key), bucket);
    return decision;
  }
  async refund(rule: RateLimitRule, key: string): Promise<void> {
    const bucket = this.buckets.get(this.keyOf(rule, key));
    if (bucket) this.buckets.set(this.keyOf(rule, key), refundRateLimit(bucket, rule));
  }
  async reset(rule: RateLimitRule, key: string): Promise<void> {
    this.buckets.delete(this.keyOf(rule, key));
  }
}

export class FakePasswordHasherPort implements PasswordHasherPort {
  /** verifyDummy が呼ばれた回数(応答時間をそろえるための空振りが行われたかの確認用)。 */
  dummyVerifications = 0;
  /** verify が呼ばれた回数(パスワードの照合まで進んだ試行の数)。 */
  verifications = 0;

  async hash(password: string): Promise<string> {
    return `HASH:${password}`;
  }
  async verify(hash: string, password: string): Promise<boolean> {
    this.verifications++;
    return hash === `HASH:${password}`;
  }
  async verifyDummy(_password: string): Promise<void> {
    this.dummyVerifications++;
  }
}

export class FakeStoragePort implements StoragePort {
  readonly files = new Map<string, { contentType: string; body: Uint8Array }>();
  /** put を失敗させる(保存の失敗の確認用)。 */
  failPut = false;

  async put(key: string, contentType: string, body: Uint8Array): Promise<StoredFile> {
    if (this.failPut) throw new Error('保存に失敗しました(テスト)');
    this.files.set(key, { contentType, body });
    return { key, contentType, byteSize: body.byteLength };
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.files.get(key)?.body ?? null;
  }
  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
  async signedUrl(key: string): Promise<string> {
    return `fake://${key}`;
  }
}

export class FakeMirrorSenderPort implements MirrorSenderPort {
  readonly dailyReports: DailyReportMirrorPayload[] = [];
  readonly accidentReports: AccidentReportMirrorPayload[] = [];
  readonly receipts: ReceiptMirrorPayload[] = [];
  readonly attendanceDays: AttendanceDayMirrorPayload[] = [];
  readonly attendanceAggregates: AttendanceAggregateMirrorPayload[] = [];
  /** 次の送信を失敗させる回数。 */
  failures = 0;
  /** 送信のたびに呼ぶ(送信中に他で起きることを差し込むテスト用)。 */
  onSend: (() => void) | null = null;

  private maybeFail() {
    this.onSend?.();
    if (this.failures > 0) {
      this.failures--;
      throw new Error('GAS Bridge エラー(テスト)');
    }
  }
  async sendDailyReport(payload: DailyReportMirrorPayload): Promise<void> {
    this.maybeFail();
    this.dailyReports.push(payload);
  }
  async sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void> {
    this.maybeFail();
    this.accidentReports.push(payload);
  }
  async sendReceipt(payload: ReceiptMirrorPayload): Promise<void> {
    this.maybeFail();
    this.receipts.push(payload);
  }
  async sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void> {
    this.maybeFail();
    this.attendanceDays.push(payload);
  }
  async sendAttendanceAggregate(payload: AttendanceAggregateMirrorPayload): Promise<void> {
    this.maybeFail();
    this.attendanceAggregates.push(payload);
  }
}

export class FakeSchedulePort implements SchedulePort {
  private readonly results = new Map<string, ScheduleWithRouteResult>();
  private readonly errors = new Map<string, string>();
  readonly calls: {
    staffId: string;
    staffName: string;
    date: string;
    forceRefresh: boolean;
    options?: ScheduleWithRouteOptions;
  }[] = [];

  setAppointments(
    staffName: string,
    date: string,
    appointments: NonNullable<ScheduleWithRouteResult['appointments']>,
  ): void {
    this.results.set(`${staffName}|${date}`, { success: true, date, staffName, appointments });
  }
  setFailure(staffName: string, date: string, message: string): void {
    this.results.set(`${staffName}|${date}`, { success: false, message });
  }
  /** 例外(外部サービスの失敗)を投げさせる。 */
  clearError(staffName: string, date: string): void {
    this.errors.delete(`${staffName}|${date}`);
  }
  setError(staffName: string, date: string, message: string): void {
    this.errors.set(`${staffName}|${date}`, message);
  }

  async getSchedule(
    target: ScheduleTarget,
    dateString: string,
    options?: ScheduleRequestOptions,
  ): Promise<ScheduleLightResult> {
    const result = await this.getScheduleWithRoute(target, dateString, false, options);
    return {
      success: result.success,
      appointments: (result.appointments ?? []).map((a) => ({
        title: a.customerName,
        eventType: a.eventType,
        start: a.startTime,
        end: a.endTime,
        address: a.address,
      })),
    };
  }

  async getScheduleWithRoute(
    target: ScheduleTarget,
    dateString: string,
    forceRefresh: boolean,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleWithRouteResult> {
    this.calls.push({ ...target, date: dateString, forceRefresh, ...(options ? { options } : {}) });
    const error = this.errors.get(`${target.staffName}|${dateString}`);
    if (error) throw new Error(error);
    return this.results.get(`${target.staffName}|${dateString}`) ?? { success: true, appointments: [] };
  }
}

/** Web Push の送信(送った通知を記録する)。endpoint ごとに結果・失敗を決められる。 */
export class FakeWebPushSender implements WebPushSenderPort {
  /** 受け付けられた(delivered)送信。 */
  readonly sent: { endpoint: string; notice: PushNotice; options: WebPushSendOptions }[] = [];
  /** 送ろうとした全ての endpoint(結果を問わない。順に)。 */
  readonly attempts: string[] = [];
  private readonly outcomes = new Map<string, WebPushSendResult | Error>();

  /** endpoint への送信の結果(既定は delivered)。Error を渡すとその例外を投げる。 */
  setOutcome(endpoint: string, outcome: WebPushSendResult | Error): void {
    this.outcomes.set(endpoint, outcome);
  }

  async send(
    target: WebPushTarget,
    notice: PushNotice,
    options: WebPushSendOptions,
  ): Promise<WebPushSendResult> {
    this.attempts.push(target.endpoint);
    const outcome = this.outcomes.get(target.endpoint) ?? { status: 'delivered' };
    if (outcome instanceof Error) throw outcome;
    if (outcome.status === 'delivered') {
      this.sent.push({ endpoint: target.endpoint, notice: structuredClone(notice), options });
    }
    return outcome;
  }
}

/** Drive のフォルダID → ファイル名 → 中身(取込元の設定のあるテナントだけ、そのフォルダを読む)。 */
export class FakeCustomerCsvSource implements CustomerCsvSourcePort {
  private readonly folders = new Map<string, Map<string, Buffer>>();

  put(driveFolderId: string, name: string, content: Buffer): void {
    const folder = this.folders.get(driveFolderId) ?? new Map<string, Buffer>();
    folder.set(name, content);
    this.folders.set(driveFolderId, folder);
  }

  async listFiles(location: CustomerCsvLocation): Promise<CustomerCsvSourceFile[] | null> {
    if (!location.settings) return null;
    const folder = this.folders.get(location.settings.driveFolderId) ?? new Map<string, Buffer>();
    return [...folder.keys()].map((name) => ({ id: name, name }));
  }

  async readFile(location: CustomerCsvLocation, file: CustomerCsvSourceFile): Promise<Buffer> {
    const content = location.settings && this.folders.get(location.settings.driveFolderId)?.get(file.id);
    if (!content) throw new Error(`ファイルがありません: ${file.name}`);
    return content;
  }
}
