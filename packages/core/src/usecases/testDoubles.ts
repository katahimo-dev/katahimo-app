import { createHash, createHmac } from 'node:crypto';
import type { BlindIndexPort, CryptoPort, EncryptedValue } from '../ports/crypto';
import type { MirrorJob, OutboxJobRecord, OutboxRepositoryPort } from '../ports/mirror';
import type {
  AccidentReportMirrorPayload,
  AttendanceDayMirrorPayload,
  DailyReportMirrorPayload,
  MirrorSenderPort,
  ReceiptMirrorPayload,
} from '../ports/mirrorSender';
import type { NotificationChannel, NotifierPort } from '../ports/notifier';
import type {
  AccidentReportRecord,
  AccidentReportRepositoryPort,
  ActiveStaffRecord,
  AppSettingsPatchInput,
  AppSettingsRecord,
  AppSettingsRepositoryPort,
  AttendanceDayRecord,
  AttendanceDayRepositoryPort,
  CustomerPatchInput,
  CustomerProfileFields,
  CustomerRecord,
  CustomerRepositoryPort,
  DailyReportRecord,
  DailyReportRepositoryPort,
  EncryptedField,
  FamilyMemberRecord,
  FamilyMemberRepositoryPort,
  NewAccidentReportInput,
  NewCustomerInput,
  NewDailyReportInput,
  NewFamilyMemberInput,
  NewReceiptInput,
  NewSessionInput,
  NewStaffInput,
  NewTenantInput,
  ReceiptRecord,
  ReceiptRepositoryPort,
  SessionRecord,
  SessionRepositoryPort,
  StaffRecord,
  StaffRepositoryPort,
  TenantRecord,
  TenantRepositoryPort,
} from '../ports/repositories';
import type { StoragePort, StoredFile } from '../ports/storage';
import type { PasswordHasherPort } from './auth';

/**
 * usecasesのテスト用インメモリ実装群。実DBやKMSを使わず、ports契約だけを満たす形で
 * ドメインロジック(特に「登録時と検索時でブラインドインデックスの正規化が一致しているか」)
 * を検証するためのもの。テスト専用であり、本番コードから参照してはいけない。
 */

/** 暗号化は行わず`ENC:平文`のタグを付けるだけの、検証しやすいフェイク実装。 */
export class FakeCryptoPort implements CryptoPort {
  async encrypt(_tenantId: string, plaintext: string): Promise<EncryptedValue> {
    return { ciphertext: `ENC:${plaintext}`, keyVersion: 1 };
  }
  async decrypt(_tenantId: string, value: EncryptedValue): Promise<string> {
    return value.ciphertext.replace(/^ENC:/, '');
  }
}

/** 本物同様HMAC-SHA256を使う(正規化ミスを検出したいので、ここだけは本物と同じ計算にする)。 */
export class FakeBlindIndexPort implements BlindIndexPort {
  async compute(tenantId: string, normalizedValue: string): Promise<string> {
    const key = createHash('sha256').update('test-fixed-key').update(tenantId).digest();
    return createHmac('sha256', key).update(normalizedValue, 'utf8').digest('hex');
  }
}

/** notify()の呼び出しを記録するだけの、通知先を持たないフェイク実装。 */
export class FakeNotifierPort implements NotifierPort {
  readonly notifications: { tenantId: string; channel: NotificationChannel; text: string }[] = [];

  async notify(tenantId: string, channel: NotificationChannel, text: string): Promise<void> {
    this.notifications.push({ tenantId, channel, text });
  }
}

export class FakePasswordHasherPort implements PasswordHasherPort {
  async hash(password: string): Promise<string> {
    return `HASH:${password}`;
  }
  async verify(hash: string, password: string): Promise<boolean> {
    return hash === `HASH:${password}`;
  }
}

export class FakeTenantRepository implements TenantRepositoryPort {
  private readonly rows = new Map<string, TenantRecord>();
  private seq = 0;

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    return [...this.rows.values()].find((t) => t.slug === slug) ?? null;
  }
  async create(input: NewTenantInput): Promise<TenantRecord> {
    const record: TenantRecord = { id: `tenant-${++this.seq}`, name: input.name, slug: input.slug };
    this.rows.set(record.id, record);
    return record;
  }
  async listAll(): Promise<TenantRecord[]> {
    return [...this.rows.values()];
  }
}

export class FakeStaffRepository implements StaffRepositoryPort {
  private readonly rows: StaffRecord[] = [];
  private seq = 0;

  async findByEmail(tenantId: string, email: string): Promise<StaffRecord | null> {
    return this.rows.find((s) => s.tenantId === tenantId && s.email === email) ?? null;
  }
  async findById(tenantId: string, staffId: string): Promise<StaffRecord | null> {
    return this.rows.find((s) => s.tenantId === tenantId && s.id === staffId) ?? null;
  }
  async create(input: NewStaffInput): Promise<StaffRecord> {
    const record: StaffRecord = {
      id: `staff-${++this.seq}`,
      tenantId: input.tenantId,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash ?? null,
      legacyPasswordHash: input.legacyPasswordHash ?? null,
      isAdmin: input.isAdmin,
      retirementDate: null,
    };
    this.rows.push(record);
    return record;
  }

  async upgradeToArgon2Hash(tenantId: string, staffId: string, passwordHash: string): Promise<void> {
    const record = this.rows.find((s) => s.tenantId === tenantId && s.id === staffId);
    if (record) {
      record.passwordHash = passwordHash;
      record.legacyPasswordHash = null;
    }
  }

  async listActive(tenantId: string): Promise<ActiveStaffRecord[]> {
    const todayStr = new Date().toISOString().slice(0, 10);
    return this.rows
      .filter((s) => s.tenantId === tenantId && (!s.retirementDate || s.retirementDate > todayStr))
      .map((s) => ({ id: s.id, name: s.name }));
  }

  /** テスト専用: 退職日を設定する(create()の入力にretirementDateが無いため)。 */
  setRetirementDateForTest(tenantId: string, staffId: string, retirementDate: string | null): void {
    const record = this.rows.find((s) => s.tenantId === tenantId && s.id === staffId);
    if (record) record.retirementDate = retirementDate;
  }
}

export class FakeSessionRepository implements SessionRepositoryPort {
  private readonly rows: (SessionRecord & { tokenHash: string })[] = [];
  private seq = 0;

  async create(input: NewSessionInput): Promise<SessionRecord> {
    const record = {
      id: `session-${++this.seq}`,
      tenantId: input.tenantId,
      staffId: input.staffId,
      expiresAt: input.expiresAt,
      tokenHash: input.tokenHash,
    };
    this.rows.push(record);
    return record;
  }
  async findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null> {
    return this.rows.find((s) => s.tenantId === tenantId && s.tokenHash === tokenHash) ?? null;
  }
}

const EMPTY_PROFILE_FIELDS: CustomerProfileFields = {
  externalSource: null,
  externalId: null,
  familyNameKana: null,
  givenNameKana: null,
  email: null,
  phone: null,
  addressDetail: null,
  city: null,
  parkingArea: null,
  parkingDetail: null,
  emergencyContact: null,
  emergencyContactRelation: null,
  evacuationSite: null,
  memo: null,
  benefitMemberId: null,
  address2: null,
  address2StartDate: null,
  address2EndDate: null,
  latLng: null,
  memberType: null,
  memberStatus: null,
  paymentMethod: null,
  paymentStatus: null,
  gender: null,
  ageBracket: null,
  registeredAt: null,
  externalLastUpdatedAt: null,
};

interface StoredCustomer {
  record: CustomerRecord;
}

export class FakeCustomerRepository implements CustomerRepositoryPort {
  private readonly rows: StoredCustomer[] = [];
  private seq = 0;

  async create(input: NewCustomerInput): Promise<CustomerRecord> {
    const record: CustomerRecord = {
      ...EMPTY_PROFILE_FIELDS,
      ...input,
      id: `customer-${++this.seq}`,
      deactivatedAt: null,
    };
    this.rows.push({ record });
    return record;
  }

  async findById(tenantId: string, customerId: string): Promise<CustomerRecord | null> {
    return (
      this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId)?.record ?? null
    );
  }

  async findByFamilyName(tenantId: string, familyName: string): Promise<CustomerRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.record.familyName === familyName)
      .map((r) => r.record);
  }

  async findByExternalId(
    tenantId: string,
    externalSource: string,
    externalId: string,
  ): Promise<CustomerRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.record.tenantId === tenantId &&
          r.record.externalSource === externalSource &&
          r.record.externalId === externalId,
      )?.record ?? null
    );
  }

  async listActiveExternalIds(tenantId: string, externalSource: string): Promise<string[]> {
    return this.rows
      .filter(
        (r) =>
          r.record.tenantId === tenantId &&
          r.record.externalSource === externalSource &&
          r.record.externalId !== null &&
          r.record.deactivatedAt === null,
      )
      .map((r) => r.record.externalId as string);
  }

  async listActive(tenantId: string): Promise<CustomerRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.record.deactivatedAt === null)
      .map((r) => r.record);
  }

  async update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord> {
    const stored = this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId);
    if (!stored) throw new Error(`customer not found: ${customerId}`);
    stored.record = { ...stored.record, ...patch };
    return stored.record;
  }

  async deactivate(tenantId: string, customerId: string): Promise<void> {
    const stored = this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId);
    if (stored) stored.record = { ...stored.record, deactivatedAt: new Date() };
  }
}

interface StoredFamilyMember {
  record: FamilyMemberRecord;
}

export class FakeFamilyMemberRepository implements FamilyMemberRepositoryPort {
  private readonly rows: StoredFamilyMember[] = [];
  private seq = 0;

  private toRecord(input: NewFamilyMemberInput): FamilyMemberRecord {
    return {
      id: `family-member-${++this.seq}`,
      tenantId: input.tenantId,
      customerId: input.customerId,
      name: input.name,
      dob: input.dob,
      info: input.info,
    };
  }

  async createMany(inputs: NewFamilyMemberInput[]): Promise<FamilyMemberRecord[]> {
    const created = inputs.map((i) => this.toRecord(i));
    this.rows.push(...created.map((record) => ({ record })));
    return created;
  }

  async listByCustomerId(tenantId: string, customerId: string): Promise<FamilyMemberRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.record.customerId === customerId)
      .map((r) => r.record);
  }

  async replaceForCustomer(
    tenantId: string,
    customerId: string,
    inputs: NewFamilyMemberInput[],
  ): Promise<FamilyMemberRecord[]> {
    const keep = this.rows.filter(
      (r) => !(r.record.tenantId === tenantId && r.record.customerId === customerId),
    );
    this.rows.length = 0;
    this.rows.push(...keep);
    return this.createMany(inputs);
  }
}

export class FakeAttendanceDayRepository implements AttendanceDayRepositoryPort {
  private readonly rows: AttendanceDayRecord[] = [];
  private seq = 0;

  async findByStaffAndDate(
    tenantId: string,
    staffId: string,
    businessDate: string,
  ): Promise<AttendanceDayRecord | null> {
    return (
      this.rows.find(
        (r) => r.tenantId === tenantId && r.staffId === staffId && r.businessDate === businessDate,
      ) ?? null
    );
  }

  async findById(tenantId: string, id: string): Promise<AttendanceDayRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }

  async upsert(
    tenantId: string,
    staffId: string,
    businessDate: string,
    rowData: EncryptedField,
  ): Promise<AttendanceDayRecord> {
    const existing = this.rows.find(
      (r) => r.tenantId === tenantId && r.staffId === staffId && r.businessDate === businessDate,
    );
    if (existing) {
      existing.rowData = rowData;
      return existing;
    }
    const record: AttendanceDayRecord = {
      id: `attendance-day-${++this.seq}`,
      tenantId,
      staffId,
      businessDate,
      rowData,
    };
    this.rows.push(record);
    return record;
  }

  async listByStaffAndMonth(
    tenantId: string,
    staffId: string,
    yearMonth: string,
  ): Promise<AttendanceDayRecord[]> {
    return this.rows.filter(
      (r) => r.tenantId === tenantId && r.staffId === staffId && r.businessDate.startsWith(yearMonth),
    );
  }

  async listByStaffAndDateRange(
    tenantId: string,
    staffId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayRecord[]> {
    return this.rows.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.staffId === staffId &&
        r.businessDate >= startDate &&
        r.businessDate <= endDate,
    );
  }
}

export class FakeAppSettingsRepository implements AppSettingsRepositoryPort {
  private readonly rows = new Map<string, AppSettingsRecord>();

  async find(tenantId: string): Promise<AppSettingsRecord | null> {
    return this.rows.get(tenantId) ?? null;
  }

  async upsert(tenantId: string, patch: AppSettingsPatchInput): Promise<AppSettingsRecord> {
    const existing: AppSettingsRecord = this.rows.get(tenantId) ?? {
      tenantId,
      geminiApiKey: null,
      geminiReportModel: null,
      geminiOcrModel: null,
      gchatReportWebhookUrl: null,
      gchatReceiptWebhookUrl: null,
    };
    const updated: AppSettingsRecord = { ...existing, ...patch };
    this.rows.set(tenantId, updated);
    return updated;
  }
}

/** ファイルシステムを使わないインメモリ実装。 */
export class FakeStoragePort implements StoragePort {
  private readonly files = new Map<string, { contentType: string; body: Uint8Array }>();

  async put(key: string, contentType: string, body: Uint8Array): Promise<StoredFile> {
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

export class FakeDailyReportRepository implements DailyReportRepositoryPort {
  private readonly rows: DailyReportRecord[] = [];
  private seq = 0;

  async create(input: NewDailyReportInput): Promise<DailyReportRecord> {
    const record: DailyReportRecord = { id: `daily-report-${++this.seq}`, ...input };
    this.rows.push(record);
    return record;
  }
  async update(tenantId: string, id: string, input: NewDailyReportInput): Promise<DailyReportRecord | null> {
    const index = this.rows.findIndex((r) => r.tenantId === tenantId && r.id === id);
    if (index === -1) return null;
    const record: DailyReportRecord = { id, ...input };
    this.rows[index] = record;
    return record;
  }
  async findById(tenantId: string, id: string): Promise<DailyReportRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }
  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<DailyReportRecord[]> {
    return this.rows
      .filter(
        (r) => r.tenantId === tenantId && r.customerId === customerId && (!before || r.occurredAt < before),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }
}

export class FakeAccidentReportRepository implements AccidentReportRepositoryPort {
  private readonly rows: AccidentReportRecord[] = [];
  private seq = 0;

  async create(input: NewAccidentReportInput): Promise<AccidentReportRecord> {
    const record: AccidentReportRecord = { id: `accident-report-${++this.seq}`, ...input };
    this.rows.push(record);
    return record;
  }
  async update(
    tenantId: string,
    id: string,
    input: NewAccidentReportInput,
  ): Promise<AccidentReportRecord | null> {
    const index = this.rows.findIndex((r) => r.tenantId === tenantId && r.id === id);
    if (index === -1) return null;
    const record: AccidentReportRecord = { id, ...input };
    this.rows[index] = record;
    return record;
  }
  async findById(tenantId: string, id: string): Promise<AccidentReportRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }
  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<AccidentReportRecord[]> {
    return this.rows
      .filter(
        (r) => r.tenantId === tenantId && r.customerId === customerId && (!before || r.occurredAt < before),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }
}

interface StoredReceipt {
  record: ReceiptRecord;
  dedupeBlindIndex: string | null;
}

export class FakeReceiptRepository implements ReceiptRepositoryPort {
  private readonly rows: StoredReceipt[] = [];
  private seq = 0;

  async create(input: NewReceiptInput): Promise<ReceiptRecord> {
    const record: ReceiptRecord = {
      id: `receipt-${++this.seq}`,
      tenantId: input.tenantId,
      staffId: input.staffId,
      customerId: input.customerId,
      receiptTimestamp: input.receiptTimestamp,
      amount: input.amount,
      storeName: input.storeName,
      handoffText: input.handoffText,
      fileKey: input.fileKey,
      contentType: input.contentType,
    };
    this.rows.push({ record, dedupeBlindIndex: input.dedupeBlindIndex });
    return record;
  }

  async findById(tenantId: string, id: string): Promise<ReceiptRecord | null> {
    return this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === id)?.record ?? null;
  }

  async findExistingDedupeIndexes(tenantId: string, dedupeBlindIndexes: string[]): Promise<Set<string>> {
    const keys = new Set(dedupeBlindIndexes);
    return new Set(
      this.rows
        .filter((r) => r.record.tenantId === tenantId && r.dedupeBlindIndex && keys.has(r.dedupeBlindIndex))
        .map((r) => r.dedupeBlindIndex as string),
    );
  }
}

/**
 * outbox_jobsのインメモリ実装。テナントごとの配列で保持し、claimPendingはDrizzle実装と同様に
 * pending→processingへ遷移させてから返す(実DBのFOR UPDATE SKIP LOCKEDに相当する排他制御は
 * テストでは不要なため省略)。
 */
export class FakeOutboxRepository implements OutboxRepositoryPort {
  private readonly rows: (OutboxJobRecord & { idempotencyKey: string; status: string })[] = [];
  private seq = 0;

  async enqueue(job: MirrorJob): Promise<void> {
    if (this.rows.some((r) => r.tenantId === job.tenantId && r.idempotencyKey === job.idempotencyKey)) {
      return;
    }
    this.rows.push({
      id: `outbox-${++this.seq}`,
      tenantId: job.tenantId,
      kind: job.kind,
      targetId: job.targetId,
      idempotencyKey: job.idempotencyKey,
      attempts: 0,
      status: 'pending',
    });
  }

  async claimPending(tenantId: string, limit: number): Promise<OutboxJobRecord[]> {
    const claimed = this.rows
      .filter((r) => r.tenantId === tenantId && r.status === 'pending')
      .slice(0, limit);
    for (const r of claimed) {
      r.status = 'processing';
      r.attempts += 1;
    }
    return claimed.map(({ id, tenantId: t, kind, targetId, attempts }) => ({
      id,
      tenantId: t,
      kind,
      targetId,
      attempts,
    }));
  }

  async markDone(tenantId: string, id: string): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    if (row) row.status = 'done';
  }

  async markFailed(tenantId: string, id: string): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    if (row) row.status = 'failed';
  }

  /** テスト専用: 現在保持しているジョブ一覧(statusを含む)を確認する。 */
  listAllForTest(): readonly (OutboxJobRecord & { idempotencyKey: string; status: string })[] {
    return this.rows;
  }
}

/** send*()の呼び出し引数を記録するだけの、実際には何も送らないフェイク実装。 */
export class FakeMirrorSenderPort implements MirrorSenderPort {
  readonly dailyReports: DailyReportMirrorPayload[] = [];
  readonly accidentReports: AccidentReportMirrorPayload[] = [];
  readonly receipts: ReceiptMirrorPayload[] = [];
  readonly attendanceDays: AttendanceDayMirrorPayload[] = [];

  async sendDailyReport(payload: DailyReportMirrorPayload): Promise<void> {
    this.dailyReports.push(payload);
  }
  async sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void> {
    this.accidentReports.push(payload);
  }
  async sendReceipt(payload: ReceiptMirrorPayload): Promise<void> {
    this.receipts.push(payload);
  }
  async sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void> {
    this.attendanceDays.push(payload);
  }
}
