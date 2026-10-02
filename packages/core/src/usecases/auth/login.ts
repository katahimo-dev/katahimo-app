import {
  isRetiredOn,
  maskEmail,
  normalizeEmailForIndex,
  rateLimitIpSubject,
  zonedBusinessDate,
} from '../../domain';
import type { StaffRole } from '../../domain/model';
import { accountRateLimitKey } from '../rateLimits';
import type { RequestMeta } from '../requestMeta';
import { currentTime } from '../requestMeta';
import type { LoginDeps } from './deps';
import {
  deviceCredentialVersion,
  deviceRateLimitKey,
  issueDeviceToken,
  parseDeviceToken,
  verifyDeviceToken,
} from './deviceTrust';
import { checkStaffPassword } from './passwordVerification';
import { openSession } from './session';

export interface LoginInput {
  tenantSlug: string;
  /** スタッフのメールアドレスまたはサブメール(GAS版のE列/M列のどちらでもよい)。 */
  email: string;
  password: string;
  /** 「この端末」の印の Cookie の値(deviceTrust.ts)。無い・形が不正・別のアカウントのものはふつうのログインとして扱う。 */
  deviceToken?: string | undefined;
  meta?: RequestMeta;
}

export interface LoggedInStaff {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: StaffRole;
}

export type LoginFailureReason = 'invalid_credentials' | 'retired' | 'tenant_suspended';

export type LoginResult =
  | {
      ok: true;
      sessionCookieValue: string;
      expiresAt: Date;
      /** 新しく発行した「この端末」の印(ログインのたびに発行し直す)。 */
      deviceToken: { value: string; expiresAt: Date };
      staff: LoggedInStaff;
    }
  | { ok: false; reason: LoginFailureReason }
  /** 失敗が続いたため一時的にロック中(アカウント単位・端末単位・送信元IP単位)。 */
  | { ok: false; reason: 'locked'; retryAfterMs: number };

/**
 * メール(またはサブメール)+パスワードでのログイン(GAS版 Auth.js verifyLogin)。
 *
 * テナントはログインフォームの tenantSlug で先に特定する(platform.tenants、RLS なし)。利用者の列挙を防ぐため、
 * テナント・アカウントが無い場合もパスワード不一致と同じ結果を返し、ダミーの argon2 照合で同じだけ時間をかける。
 * 退職済み・テナント停止中の判定はパスワードが一致した後に行う(パスワードを知らない人に在籍状況を伝えない)。
 *
 * 総当たり対策: 試行を送信元IP単位、続いてアカウント単位(存在しないアカウントも同じく数える)で数え、上限で一時ロック。
 * 送信元IPでロック中の要求はアカウントの分を数えない(第三者が1つのIPから送り続けても、アカウントの枠は減らない)。
 * 前に正しくログインできた端末(「この端末」の印が正しい。deviceTrust.ts)からの要求は、アカウント単位の代わりに
 * 「アカウント × 端末」単位で数える: アカウントがロック中でも本人の端末からはログインでき(締め出しの妨害を防ぐ)、
 * 印を盗んだ人もその印の枠を超えては試せない。
 * 数えるのはパスワードの照合の前(枠を取ってから照合する)。照合の後に数えると、同時に送られた多数の試行が全て
 * 「まだ上限前」と判定されて照合まで進んでしまう。成功した回は取り消す(アカウント・端末は数え直し、送信元IPは1回分を返す)。
 * 端末の印での成功ではアカウント単位の回数は戻さない(第三者の試行の枠を戻さない)。
 * パスワードの照合(argon2、時間がかかる)はトランザクションの外で行う。
 */
export async function login(deps: LoginDeps, input: LoginInput): Promise<LoginResult> {
  const now = currentTime(deps);
  const loginId = normalizeEmailForIndex(input.email);
  const accountKey = accountRateLimitKey(input.tenantSlug, loginId);
  // 送信元IP単位の数え方は IPv6 なら /64 ごと(アドレスを替えながらの回避を防ぐ。ログには元のアドレスを残す)
  const ip = input.meta?.ip ? rateLimitIpSubject(input.meta.ip) : null;
  const { loginFailureAccount, loginFailureDevice, loginFailureIp } = deps.rateLimits;
  const masked = maskEmail(loginId);

  const logLocked = (scope: 'ip' | 'account' | 'device', tenantId: string | null, staffId?: string) =>
    deps.appLog.write({
      tenantId,
      level: 'SECURITY',
      action: 'auth.login.locked',
      actorStaffId: staffId ?? null,
      details: { scope, loginId: masked },
      ...input.meta,
    });

  // 先に送信元IPの1回分の枠を取る。ロック中ならアカウントの枠には触れずに断る
  const byIp = ip ? await deps.rateLimiter.consume(loginFailureIp, ip, now) : null;
  if (byIp && !byIp.allowed) {
    await logLocked('ip', null);
    return { ok: false, reason: 'locked', retryAfterMs: byIp.retryAfterMs };
  }

  const tenant = await deps.tenants.findBySlug(input.tenantSlug.trim().toLowerCase());
  const account = tenant
    ? await deps.uow.run(tenant.id, async (r) => {
        const staff = await r.staff.findByLoginEmail(loginId);
        return staff ? { staff, credentials: await r.staff.getCredentials(staff.id) } : null;
      })
    : null;

  // 「この端末」の印がこのアカウントのものなら、アカウント単位の代わりに端末単位で数える
  const presented = parseDeviceToken(input.deviceToken);
  const trustedDevice =
    tenant && account && presented
      ? verifyDeviceToken(
          deps.deviceTrustSecret,
          presented,
          {
            tenantId: tenant.id,
            staffId: account.staff.id,
            credentialVersion: deviceCredentialVersion(account.credentials, account.staff.retiredOn),
          },
          now,
        )
        ? presented
        : null
      : null;
  const device = trustedDevice ? 'trusted' : input.deviceToken ? 'invalid' : null;
  const bucket = trustedDevice
    ? { scope: 'device' as const, rule: loginFailureDevice, key: deviceRateLimitKey(trustedDevice) }
    : { scope: 'account' as const, rule: loginFailureAccount, key: accountKey };

  // 照合の前に1回分の枠を取る(同時の試行でも、照合まで進めるのは上限の回数まで)
  const byAccount = await deps.rateLimiter.consume(bucket.rule, bucket.key, now);
  if (!byAccount.allowed) {
    await logLocked(bucket.scope, tenant?.id ?? null, account?.staff.id);
    return { ok: false, reason: 'locked', retryAfterMs: byAccount.retryAfterMs };
  }

  const recordFailure = async (tenantId: string | null, reason: string, staffId?: string) => {
    if (tenantId && staffId) {
      // locked_until は管理者が見るためのアカウント単位のロックの写し(端末単位のロックは写さない)
      const lockedUntil =
        bucket.scope === 'account' && byAccount.lockStarted
          ? new Date(now.getTime() + byAccount.retryAfterMs)
          : null;
      await deps.uow.run(tenantId, (r) => r.staff.recordLoginFailure(staffId, lockedUntil));
    }
    await deps.appLog.write({
      tenantId,
      level: 'SECURITY',
      action: 'auth.login.failed',
      actorStaffId: staffId ?? null,
      details: { reason, loginId: masked, ...(device ? { device } : {}) },
      ...input.meta,
    });
    const lockScope = byAccount.lockStarted ? bucket.scope : byIp?.lockStarted ? 'ip' : null;
    if (lockScope) {
      await deps.appLog.write({
        tenantId,
        level: 'SECURITY',
        action: 'auth.login.lockout_started',
        actorStaffId: staffId ?? null,
        details: { scope: lockScope, loginId: masked },
        ...input.meta,
      });
    }
  };

  if (!tenant) {
    await deps.passwordHasher.verifyDummy(input.password);
    await recordFailure(null, 'tenant_not_found');
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (!account) {
    await deps.passwordHasher.verifyDummy(input.password);
    await recordFailure(tenant.id, 'unknown_login_id');
    return { ok: false, reason: 'invalid_credentials' };
  }
  const { staff, credentials } = account;

  const check = await checkStaffPassword(deps, credentials, input.password);
  if (check === 'mismatch') {
    const reason =
      credentials?.passwordHash || credentials?.legacyPasswordHash ? 'invalid_password' : 'password_not_set';
    await recordFailure(tenant.id, reason, staff.id);
    return { ok: false, reason: 'invalid_credentials' };
  }
  // パスワードが一致した回は数えない(使った枠は数え直し、送信元IPは先に取った1回分を返す)
  await Promise.all([
    deps.rateLimiter.reset(bucket.rule, bucket.key),
    ip ? deps.rateLimiter.refund(loginFailureIp, ip) : null,
  ]);

  const refuse = async (reason: 'tenant_suspended' | 'retired'): Promise<LoginResult> => {
    await deps.appLog.write({
      tenantId: tenant.id,
      level: 'SECURITY',
      action: 'auth.login.failed',
      actorStaffId: staff.id,
      details: { reason, loginId: masked },
      ...input.meta,
    });
    return { ok: false, reason };
  };
  if (tenant.status !== 'active') return refuse('tenant_suspended');
  if (isRetiredOn(staff.retiredOn, zonedBusinessDate(now, tenant.timezone))) return refuse('retired');

  // GAS版から移行したスタッフは、一致したパスワードで argon2id へ移す(パスワード変更を求めずに移行する)
  const rehashed = check === 'matched_legacy' ? await deps.passwordHasher.hash(input.password) : null;
  const opened = await deps.uow.run(tenant.id, async (r) => {
    if (rehashed) await r.staff.setPasswordHash(staff.id, rehashed);
    await r.staff.recordLoginSuccess(staff.id);
    return openSession(r.sessions, {
      tenantId: tenant.id,
      staffId: staff.id,
      now,
      ...(input.meta ? { meta: input.meta } : {}),
    });
  });
  // 「この端末」の印はログインのたびに発行し直す(移し替えたハッシュで版が変わった場合も、新しい版で作る)
  const deviceToken = issueDeviceToken(
    deps.deviceTrustSecret,
    {
      tenantId: tenant.id,
      staffId: staff.id,
      credentialVersion: deviceCredentialVersion(
        rehashed ? { passwordHash: rehashed, legacyPasswordHash: null } : credentials,
        staff.retiredOn,
      ),
    },
    now,
  );

  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'INFO',
    action: 'auth.login.succeeded',
    actorStaffId: staff.id,
    details: {
      loginIdType: staff.email === loginId ? 'email' : 'alt_email',
      migratedLegacyPassword: rehashed !== null,
      ...(device ? { device } : {}),
    },
    ...input.meta,
  });

  return {
    ok: true,
    sessionCookieValue: opened.cookieValue,
    expiresAt: opened.expiresAt,
    deviceToken,
    staff: {
      id: staff.id,
      tenantId: tenant.id,
      name: staff.displayName,
      email: staff.email,
      role: staff.role,
    },
  };
}
