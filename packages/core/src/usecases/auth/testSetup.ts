import {
  FakeAppLogPort,
  FakeMailerPort,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from '../testDoubles';
import type { PasswordResetDeps } from './deps';

/** 認証系テスト共通の依存一式(全てインメモリ)。nowは書き換えて時刻を進められる。 */
export interface AuthTestContext {
  deps: PasswordResetDeps;
  staff: FakeStaffRepository;
  sessions: FakeSessionRepository;
  appLog: FakeAppLogPort;
  mailer: FakeMailerPort;
  resetCodes: FakePasswordResetCodeRepository;
  clock: { now: Date };
  tenantId: string;
}

export async function createAuthTestContext(): Promise<AuthTestContext> {
  const tenants = new FakeTenantRepository();
  const staff = new FakeStaffRepository();
  const sessions = new FakeSessionRepository();
  const appLog = new FakeAppLogPort();
  const mailer = new FakeMailerPort();
  const resetCodes = new FakePasswordResetCodeRepository();
  const clock = { now: new Date('2026-09-25T03:00:00Z') };
  const tenant = await tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
  return {
    deps: {
      tenants,
      staff,
      sessions,
      passwordHasher: new FakePasswordHasherPort(),
      appLog,
      mailer,
      passwordResetCodes: resetCodes,
      resetCodeSecret: 'test-secret',
      now: () => clock.now,
    },
    staff,
    sessions,
    appLog,
    mailer,
    resetCodes,
    clock,
    tenantId: tenant.id,
  };
}
