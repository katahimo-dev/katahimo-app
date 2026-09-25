import { beforeEach, describe, expect, it } from 'vitest';
import { computeLegacyHash } from '../domain';
import type { AuthDeps } from './auth';
import {
  changePassword,
  decodeSessionCookie,
  importLegacyStaff,
  login,
  registerStaff,
  resolveSession,
} from './auth';
import {
  FakePasswordHasherPort,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from './testDoubles';

describe('login / registerStaff / resolveSession', () => {
  let deps: AuthDeps;
  let tenantId: string;

  beforeEach(async () => {
    deps = {
      tenants: new FakeTenantRepository(),
      staff: new FakeStaffRepository(),
      sessions: new FakeSessionRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    const tenant = await deps.tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
    tenantId = tenant.id;
    await registerStaff(deps, {
      tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      password: 'correct-horse',
      isAdmin: false,
    });
  });

  it('正しいテナント・メール・パスワードでログインできる', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.staff.name).toBe('佐藤 花子');
    expect(result.staff.email).toBe('hanako@example.com');
    expect(result.staff.isAdmin).toBe(false);

    const decoded = decodeSessionCookie(result.sessionCookieValue);
    expect(decoded?.tenantId).toBe(tenantId);
  });

  it('メールの大文字小文字・前後空白の表記ゆれがあってもログインできる(正規化されるため)', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: '  Hanako@Example.com  ',
      password: 'correct-horse',
    });
    expect(result.ok).toBe(true);
  });

  it('パスワードが違えばログインできない', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'wrong-password',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('存在しないテナントslugではログインできない', async () => {
    const result = await login(deps, {
      tenantSlug: 'no-such-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
    });
    expect(result).toEqual({ ok: false, reason: 'tenant_not_found' });
  });

  it('ログイン成功後のセッションCookieでresolveSessionが本人を解決できる', async () => {
    const loginResult = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
    });
    if (!loginResult.ok) throw new Error('unreachable');

    const resolved = await resolveSession(deps, loginResult.sessionCookieValue);
    expect(resolved?.name).toBe('佐藤 花子');
    expect(resolved?.tenantId).toBe(tenantId);
  });

  it('不正なCookie値(区切りが無い等)はnullを返す', async () => {
    expect(await resolveSession(deps, 'not-a-valid-cookie-value')).toBeNull();
  });
});

describe('GAS版レガシーパスワードハッシュからの移行ログイン', () => {
  let deps: AuthDeps;
  let tenantId: string;
  const legacySalt = 'gas-auth-salt-example';

  beforeEach(async () => {
    deps = {
      tenants: new FakeTenantRepository(),
      staff: new FakeStaffRepository(),
      sessions: new FakeSessionRepository(),
      passwordHasher: new FakePasswordHasherPort(),
      legacyAuthSalt: legacySalt,
    };
    const tenant = await deps.tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
    tenantId = tenant.id;
    await importLegacyStaff(deps, {
      tenantId,
      name: '鈴木 次郎',
      email: 'jiro@example.com',
      legacyPasswordHash: computeLegacyHash('legacy-password', legacySalt),
      isAdmin: false,
    });
  });

  it('GAS版のパスワードのまま(変更なし)ログインできる', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'jiro@example.com',
      password: 'legacy-password',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.staff.name).toBe('鈴木 次郎');
  });

  it('ログイン成功後、argon2idへサイレント再ハッシュされ、レガシーハッシュは消える', async () => {
    await login(deps, { tenantSlug: 'test-tenant', email: 'jiro@example.com', password: 'legacy-password' });

    const staffRecord = await deps.staff.findByEmail(tenantId, 'jiro@example.com');
    expect(staffRecord?.passwordHash).toBe('HASH:legacy-password');
    expect(staffRecord?.legacyPasswordHash).toBeNull();
  });

  it('再ハッシュ後は、レガシーハッシュに頼らずargon2idだけで次回ログインできる', async () => {
    await login(deps, { tenantSlug: 'test-tenant', email: 'jiro@example.com', password: 'legacy-password' });

    const secondLogin = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'jiro@example.com',
      password: 'legacy-password',
    });
    expect(secondLogin.ok).toBe(true);
  });

  it('間違ったパスワードではレガシーハッシュ経由でもログインできない', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'jiro@example.com',
      password: 'wrong-password',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('legacyAuthSaltが未設定の場合、レガシーハッシュ経由のログインはできない(移行未設定環境の安全側デフォルト)', async () => {
    const depsWithoutSalt: AuthDeps = { ...deps, legacyAuthSalt: undefined };
    const result = await login(depsWithoutSalt, {
      tenantSlug: 'test-tenant',
      email: 'jiro@example.com',
      password: 'legacy-password',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('changePasswordは、GAS版のレガシーハッシュのままでも現在のパスワードを検証して変更でき、以後argon2idだけでログインできる', async () => {
    const staffRecord = await deps.staff.findByEmail(tenantId, 'jiro@example.com');
    if (!staffRecord) throw new Error('unreachable');

    const result = await changePassword(deps, tenantId, staffRecord.id, 'legacy-password', 'new-password');
    expect(result).toEqual({ ok: true });

    const failedWithOld = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'jiro@example.com',
      password: 'legacy-password',
    });
    expect(failedWithOld.ok).toBe(false);

    const succeededWithNew = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'jiro@example.com',
      password: 'new-password',
    });
    expect(succeededWithNew.ok).toBe(true);
  });
});

describe('changePassword', () => {
  let deps: AuthDeps;
  let tenantId: string;
  let staffId: string;

  beforeEach(async () => {
    deps = {
      tenants: new FakeTenantRepository(),
      staff: new FakeStaffRepository(),
      sessions: new FakeSessionRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    const tenant = await deps.tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
    tenantId = tenant.id;
    const created = await registerStaff(deps, {
      tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      password: 'correct-horse',
      isAdmin: false,
    });
    staffId = created.id;
  });

  it('現在のパスワードが正しければ変更できる', async () => {
    const result = await changePassword(deps, tenantId, staffId, 'correct-horse', 'new-password');
    expect(result).toEqual({ ok: true });

    const loginResult = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'new-password',
    });
    expect(loginResult.ok).toBe(true);
  });

  it('現在のパスワードが間違っていれば変更を拒否する', async () => {
    const result = await changePassword(deps, tenantId, staffId, 'wrong-password', 'new-password');
    expect(result).toEqual({ ok: false, reason: 'incorrect_current_password' });
  });

  it('存在しないstaffIdでは無効セッション扱いにする', async () => {
    const result = await changePassword(deps, tenantId, 'no-such-staff', 'correct-horse', 'new-password');
    expect(result).toEqual({ ok: false, reason: 'invalid_session' });
  });
});
