/**
 * usecase のテスト共通の依存一式(全てインメモリ)。deps は各 usecase の Deps を全て満たす1つのオブジェクト。
 * clock.now を書き換えれば時刻を進められる。
 */
import type { StaffRole } from '../domain/model';
import type { TenantRecord } from '../ports/tenants';
import { registerStaff } from './auth/staffRegistration';
import { applyCustomerSnapshot } from './customers';
import { drainOutbox } from './outboxWorker';
import { DEFAULT_RATE_LIMIT_POLICY } from './rateLimits';
import type { Actor } from './requestMeta';
import type { TenantData } from './testDoubles';
import {
  FakeAppLogPort,
  FakeMailerPort,
  FakeMirrorSenderPort,
  FakeNotifierPort,
  FakeOutboxQueue,
  FakePasswordHasherPort,
  FakeRateLimiter,
  FakeSchedulePort,
  FakeSecretBox,
  FakeStoragePort,
  FakeTenantDirectory,
  FakeUnitOfWork,
  MemoryDatabase,
} from './testDoubles';

export function createTestContext(options: { now?: string; mirrorEnabled?: boolean } = {}) {
  const db = new MemoryDatabase();
  const tenant = db.addTenant({ slug: 'test-tenant', name: 'テスト法人' });
  const clock = { now: new Date(options.now ?? '2026-09-25T03:00:00Z') };
  const now = () => clock.now;
  const uow = new FakeUnitOfWork(db);
  const appLog = new FakeAppLogPort();
  const secretBox = new FakeSecretBox();
  const mailer = new FakeMailerPort();
  const notifier = new FakeNotifierPort();
  const storage = new FakeStoragePort();
  const sender = new FakeMirrorSenderPort();
  const schedule = new FakeSchedulePort();
  const passwordHasher = new FakePasswordHasherPort();
  const rateLimiter = new FakeRateLimiter();
  const queue = new FakeOutboxQueue(db);
  const tenants = new FakeTenantDirectory(db);

  const deps = {
    uow,
    tenants,
    appLog,
    secretBox,
    mailer,
    notifier,
    storage,
    sender,
    schedule,
    queue,
    passwordHasher,
    rateLimiter,
    rateLimits: DEFAULT_RATE_LIMIT_POLICY,
    resetCodeSecret: 'test-secret',
    legacyAuthSalt: undefined as string | undefined,
    mirrorEnabled: options.mirrorEnabled ?? true,
    workerId: 'test-worker',
    leaseMs: 60_000,
    now,
  };

  return {
    db,
    tenant,
    tenantId: tenant.id,
    clock,
    deps,
    uow,
    appLog,
    secretBox,
    mailer,
    notifier,
    storage,
    sender,
    schedule,
    passwordHasher,
    rateLimiter,
    queue,
    /** このテナントのインメモリの行。 */
    data(tenantId: string = tenant.id): TenantData {
      return db.of(tenantId);
    },
    setTenantStatus(status: TenantRecord['status']) {
      tenant.status = status;
    },
    setRetiredOn(staffId: string, retiredOn: string | null) {
      const row = db.of(tenant.id).staff.find((s) => s.record.id === staffId);
      if (!row) throw new Error('スタッフがいません');
      row.record.retiredOn = retiredOn;
    },
    /** スタッフを登録し、そのスタッフの Actor を返す。 */
    async addStaff(name: string, email: string, role: StaffRole = 'staff', password = 'correct-horse') {
      const staff = await registerStaff(deps, { tenantId: tenant.id, name, email, role, password });
      const actor: Actor = { tenantId: tenant.id, staffId: staff.id, role };
      return { staff, actor };
    },
    /** 顧客を1件登録し、その ID を返す(取込と同じ経路)。 */
    async addCustomer(name: string, externalId = name) {
      const [familyName = '', givenName = ''] = name.split(' ');
      await uow.run(tenant.id, (r) =>
        applyCustomerSnapshot(
          { runId: null },
          r,
          {
            source: 'reserva',
            externalId,
            displayName: name,
            familyName,
            givenName,
            attributes: {},
            home: { addressLine: '渋谷1-2-3', city: '渋谷区' },
            secondary: null,
            emergencyContact: null,
            recipients: [],
          },
          clock.now,
        ),
      );
      const found = db.of(tenant.id).customers.find((c) => c.displayName === name);
      if (!found) throw new Error('顧客を登録できませんでした');
      return found.id;
    },
    /** outbox を空になるまでワーカーと同じ処理で流す。 */
    drain() {
      return drainOutbox(deps, { maxMessages: 100 });
    },
  };
}

export type TestContext = ReturnType<typeof createTestContext>;
