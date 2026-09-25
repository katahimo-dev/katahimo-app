import { DEFAULT_RATE_LIMIT_POLICY } from '../rateLimits';
import {
  FakeAppLogPort,
  FakeCryptoPort,
  FakeMailerPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeRateLimiter,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from '../testDoubles';
import type { PasswordResetDeps } from './deps';
import { sendPasswordResetMail } from './passwordReset';

/** 認証系テスト共通の依存一式(全てインメモリ)。nowは書き換えて時刻を進められる。 */
export interface AuthTestContext {
  deps: PasswordResetDeps;
  tenants: FakeTenantRepository;
  staff: FakeStaffRepository;
  sessions: FakeSessionRepository;
  appLog: FakeAppLogPort;
  mailer: FakeMailerPort;
  resetCodes: FakePasswordResetCodeRepository;
  outbox: FakeOutboxRepository;
  rateLimiter: FakeRateLimiter;
  passwordHasher: FakePasswordHasherPort;
  clock: { now: Date };
  tenantId: string;
  /** outboxに積まれた再設定メールのジョブを、ワーカーと同じ処理(sendPasswordResetMail)で送る。 */
  deliverMails(): Promise<void>;
}

export async function createAuthTestContext(): Promise<AuthTestContext> {
  const tenants = new FakeTenantRepository();
  const staff = new FakeStaffRepository();
  const sessions = new FakeSessionRepository();
  const appLog = new FakeAppLogPort();
  const mailer = new FakeMailerPort();
  const resetCodes = new FakePasswordResetCodeRepository();
  const outbox = new FakeOutboxRepository();
  const rateLimiter = new FakeRateLimiter();
  const passwordHasher = new FakePasswordHasherPort();
  const crypto = new FakeCryptoPort();
  const clock = { now: new Date('2026-09-25T03:00:00Z') };
  outbox.now = () => clock.now;
  const tenant = await tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
  const now = () => clock.now;
  return {
    deps: {
      tenants,
      staff,
      sessions,
      passwordHasher,
      appLog,
      passwordResetCodes: resetCodes,
      crypto,
      mailOutbox: outbox,
      rateLimiter,
      rateLimits: DEFAULT_RATE_LIMIT_POLICY,
      resetCodeSecret: 'test-secret',
      now,
    },
    tenants,
    staff,
    sessions,
    appLog,
    mailer,
    resetCodes,
    outbox,
    rateLimiter,
    passwordHasher,
    clock,
    tenantId: tenant.id,
    async deliverMails() {
      for (const job of await outbox.claimPending(tenant.id, 100)) {
        if (job.kind !== 'password_reset_mail') continue;
        await sendPasswordResetMail(
          { passwordResetCodes: resetCodes, crypto, mailer, now },
          tenant.id,
          job.targetId,
        );
        await outbox.markDone(tenant.id, job.id);
      }
    },
  };
}
