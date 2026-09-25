/**
 * usecase のテスト用のインメモリ実装。UoW はテナントごとのデータを1つの入れ物に持ち、work が例外を投げたら
 * 実行前の状態に戻す(トランザクションのロールバックと同じ振る舞い)。DB の一意制約のうちテストで確かめたいもの
 * (ログイン用メール・領収書の重複・outbox の dedupe_key)は同じように弾く。
 */
import type { RateLimitBucket, RateLimitDecision, RateLimitRule } from '../domain';
import { conflict, consumeRateLimit, DomainError, refundRateLimit, STALE_WRITE_MESSAGE } from '../domain';
import type { OutboxTopic } from '../domain/model';
import type { AppLogEntry, AppLogPort } from '../ports/appLog';
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
  AuditLogPort,
  BlindIndexPort,
  BlindIndexPurpose,
  CipherContext,
  CryptoPort,
  DecryptAuditEntry,
} from '../ports/crypto';
import type {
  CustomerCsvSourceFile,
  CustomerCsvSourcePort,
  CustomerCsvSourceTenant,
} from '../ports/customerCsvSource';
import type {
  CareRecipientRecord,
  CustomerAddressRecord,
  CustomerContactRecord,
  CustomerRecord,
  CustomerSourceRecord,
} from '../ports/customers';
import type { ImportRunRecord } from '../ports/imports';
import type { KeyManagementPort, WrappedDek } from '../ports/kms';
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
import type { RateLimiterPort } from '../ports/rateLimiter';
import type { CareRecordRow, ReceiptRow, ReceiptUploadRow, StoredFileRow } from '../ports/records';
import type {
  ScheduleLightResult,
  SchedulePort,
  ScheduleTarget,
  ScheduleWithRouteOptions,
  ScheduleWithRouteResult,
} from '../ports/schedule';
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
  TenantDirectoryPort,
  TenantProvisioningPort,
  TenantRecord,
} from '../ports/tenants';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth/deps';

// ─────────────────────────────────────────────────────────────
// 入れ物
// ─────────────────────────────────────────────────────────────

interface StaffRow {
  record: StaffRecord;
  credentials: StaffCredentials & { failedCount: number; lockedUntil: Date | null };
  homeAddress: string | null;
  homeGeoEnc: Uint8Array | null;
  travelMode: 'car' | 'bicycle' | 'transit' | 'walk' | null;
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
export interface TenantData {
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
  careRecords: CareRecordRow[];
  careRecordRevisions: { careRecordId: string; bodyEnc: Uint8Array; changedBy: string | null }[];
  uploads: ReceiptUploadRow[];
  receipts: ReceiptRow[];
  files: StoredFileRow[];
  settings: TenantSettingsRecord;
  secrets: TenantSecretRecord[];
  aiPrompts: AiPromptRecord[];
  importRuns: (ImportRunRecord & { message: string | null })[];
  calendars: StaffCalendarRecord[];
  busyBlocks: { staffId: string; start: Date; end: Date }[];
  outbox: OutboxRow[];
  entityChanges: EntityChangeInput[];
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
      geminiReportModel: null,
      geminiOcrModel: null,
      careRecordRetentionDays: 1825,
      customerDataVersion: 0,
    },
    secrets: [],
    aiPrompts: [],
    importRuns: [],
    calendars: [],
    busyBlocks: [],
    outbox: [],
    entityChanges: [],
  };
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array | null) =>
  a !== null && b !== null && Buffer.from(a).equals(Buffer.from(b));

/** 全テナントのインメモリの DB。 */
export class MemoryDatabase {
  readonly tenants = new Map<string, TenantRecord>();
  readonly data = new Map<string, TenantData>();
  /** skipOutboxTopics と同じ(ミラーを無効にした環境)。 */
  skipOutboxTopics = new Set<OutboxTopic>();
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
          remarksEnc: null,
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
  };

  return {
    tenantId,
    async tenant() {
      const tenant = db.tenants.get(tenantId);
      if (!tenant) throw new Error('テナントがありません');
      return tenant;
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
          familyNameKana: null,
          givenNameKana: null,
          email: input.email,
          altEmail: input.altEmail ?? null,
          phone: input.phone ?? null,
          role: input.role,
          retiredOn: input.retiredOn ?? null,
          gender: null,
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
          homeAddress: null,
          homeGeoEnc: null,
          travelMode: null,
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
        Object.assign(row.record, patch, { rowVersion: row.record.rowVersion + 1 });
        return staffRecordOf(row);
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
          homeAddress: s.homeAddress,
          homeGeoEnc: s.homeGeoEnc,
          travelMode: s.travelMode,
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
          if (c.staffId === input.staffId && !c.usedAt) Object.assign(c, { usedAt: now, mailCodeEnc: null });
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
        Object.assign(c, { usedAt: now, mailCodeEnc: null });
        return true;
      },
      async markUsed(id, at) {
        const c = d().resetCodes.find((x) => x.id === id && !x.usedAt);
        if (c) Object.assign(c, { usedAt: at, mailCodeEnc: null });
      },
      async clearMailCode(id) {
        const c = d().resetCodes.find((x) => x.id === id);
        if (c) c.mailCodeEnc = null;
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
          memoEnc: null,
          benefitMemberIdEnc: null,
          evacuationSiteEnc: null,
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
        return c ? structuredClone(c) : null;
      },
      async insert(input) {
        const row: CareRecordRow = { ...structuredClone(input), rowVersion: 1 };
        d().careRecords.push(row);
        return structuredClone(row);
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
          (patch.bodyEnc && !sameBytes(patch.bodyEnc, c.bodyEnc)) ||
          (patch.bodySchemaVer !== undefined && patch.bodySchemaVer !== c.bodySchemaVer);
        if (bodyChanged && c.status !== 'draft') {
          d().careRecordRevisions.push({ careRecordId: id, bodyEnc: c.bodyEnc, changedBy: null });
        }
        Object.assign(c, structuredClone(patch), { rowVersion: c.rowVersion + 1 });
        return structuredClone(c);
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
        if (input.dedupeBidx && d().receipts.some((r) => sameBytes(r.dedupeBidx, input.dedupeBidx)))
          return false;
        d().receipts.push(structuredClone(input));
        return true;
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
      async listByStaffAndPeriod(staffId, from, to) {
        return structuredClone(
          d().receipts.filter((r) => r.staffId === staffId && r.receiptedAt >= from && r.receiptedAt < to),
        );
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
      async update(patch) {
        Object.assign(d().settings, patch);
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
      async put(name, valueEnc) {
        d().secrets = [
          ...d().secrets.filter((x) => x.name !== name),
          { name, valueEnc, rotatedAt: new Date() },
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
      async save(input) {
        const current = d().aiPrompts.find((x) => x.key === input.key);
        d().aiPrompts = [
          ...d().aiPrompts.filter((x) => x.key !== input.key),
          { ...input, revision: (current?.revision ?? 0) + 1, updatedAt: new Date() },
        ];
      },
      async reset(key) {
        d().aiPrompts = d().aiPrompts.filter((x) => x.key !== key);
      },
    },
    importRuns: {
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
    outbox: {
      async enqueue(message) {
        if (db.skipOutboxTopics.has(message.topic)) return;
        if (d().outbox.some((m) => m.dedupeKey === message.dedupeKey)) return;
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

/** 暗号文の代わりに `ENC|用途|行ID|平文` を返す。AAD(用途・行ID)が違えば本物と同じく復号に失敗する。 */
export class FakeCryptoPort implements CryptoPort {
  async encrypt(context: CipherContext, plaintext: string): Promise<Uint8Array> {
    return Buffer.from(`ENC|${context.tenantId}|${context.purpose}|${context.rowId}|${plaintext}`, 'utf8');
  }
  async decrypt(context: CipherContext, ciphertext: Uint8Array): Promise<string> {
    const prefix = `ENC|${context.tenantId}|${context.purpose}|${context.rowId}|`;
    const text = Buffer.from(ciphertext).toString('utf8');
    if (!text.startsWith(prefix)) throw new Error(`復号できません(文脈が違います): ${context.purpose}`);
    return text.slice(prefix.length);
  }
  async prepare(): Promise<void> {}
}

/** テストで平文を読むための補助(FakeCryptoPort の暗号文から平文を取り出す)。 */
export function fakePlaintext(value: Uint8Array | null): string | null {
  return value ? Buffer.from(value).toString('utf8').split('|').slice(4).join('|') : null;
}

export class FakeBlindIndexPort implements BlindIndexPort {
  async compute(tenantId: string, purpose: BlindIndexPurpose, normalizedValue: string): Promise<Uint8Array> {
    return Buffer.from(`BIDX|${tenantId}|${purpose}|${normalizedValue}`, 'utf8');
  }
}

export class FakeKmsPort implements KeyManagementPort {
  async wrap(dek: Uint8Array, tenantId: string): Promise<WrappedDek> {
    return { wrapped: Buffer.concat([Buffer.from(`${tenantId}|`), dek]), kekKeyName: 'fake' };
  }
  async unwrap(wrapped: WrappedDek): Promise<Uint8Array> {
    return Buffer.from(wrapped.wrapped).subarray(37);
  }
}

export class FakeAuditLogPort implements AuditLogPort {
  readonly entries: DecryptAuditEntry[] = [];
  recordDecrypt(entry: DecryptAuditEntry): void {
    this.entries.push(entry);
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

  async write(entry: AppLogEntry): Promise<void> {
    this.entries.push(entry);
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
  setError(staffName: string, date: string, message: string): void {
    this.errors.set(`${staffName}|${date}`, message);
  }

  async getSchedule(target: ScheduleTarget, dateString: string): Promise<ScheduleLightResult> {
    const result = await this.getScheduleWithRoute(target, dateString, false);
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

export class FakeCustomerCsvSource implements CustomerCsvSourcePort {
  private readonly files = new Map<string, Map<string, Buffer>>();

  put(tenantSlug: string, name: string, content: Buffer): void {
    const folder = this.files.get(tenantSlug) ?? new Map<string, Buffer>();
    folder.set(name, content);
    this.files.set(tenantSlug, folder);
  }

  async listFiles(tenant: CustomerCsvSourceTenant): Promise<CustomerCsvSourceFile[] | null> {
    const folder = this.files.get(tenant.slug);
    if (!folder) return null;
    return [...folder.keys()].map((name) => ({ id: name, name }));
  }

  async readFile(tenant: CustomerCsvSourceTenant, file: CustomerCsvSourceFile): Promise<Buffer> {
    const content = this.files.get(tenant.slug)?.get(file.id);
    if (!content) throw new Error(`ファイルがありません: ${file.name}`);
    return content;
  }
}
