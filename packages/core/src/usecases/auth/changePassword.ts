import type { PasswordPolicyViolation } from '@katahimo/shared';
import { checkPasswordPolicy } from '@katahimo/shared';
import { staffRateLimitKey } from '../rateLimits';
import type { RequestMeta } from '../requestMeta';
import { currentTime } from '../requestMeta';
import type { LoginDeps } from './deps';
import { deviceCredentialVersion, issueDeviceToken } from './deviceTrust';
import { checkStaffPassword } from './passwordVerification';

export interface ChangePasswordInput {
  tenantId: string;
  staffId: string;
  /** 変更操作を行ったセッション。これ以外のセッションは変更後に失効させる。 */
  sessionId: string;
  currentPassword: string;
  newPassword: string;
  meta?: RequestMeta;
}

export type ChangePasswordResult =
  | {
      ok: true;
      /** 新しいパスワードで作り直した「この端末」の印(前の印は資格情報の版が変わり通らなくなるため)。 */
      deviceToken: { value: string; expiresAt: Date };
    }
  | { ok: false; reason: 'invalid_session' | 'incorrect_current_password' }
  /** 現在のパスワードの誤りが続いたため一時的にロック中(スタッフ単位。API は 429)。 */
  | { ok: false; reason: 'locked'; retryAfterMs: number }
  | { ok: false; reason: 'weak_password'; violation: PasswordPolicyViolation };

/**
 * ログイン中のスタッフ自身のパスワード変更(GAS版 Auth.js changePassword)。現在のパスワードは argon2id・
 * レガシーハッシュのどちらでも確かめ、新しいパスワードは argon2id で保存する。変更後は操作中のセッション以外を
 * 全て失効させる(他の端末に残ったログインを切る)。
 *
 * 現在のパスワードの誤りはスタッフ単位で数え(password_change_failure_staff、上限で一時ロック)、セッションを奪った人が
 * 現在のパスワードを総当たりで探れないようにする。ログインと同じく照合の前に1回分の枠を取り、一致した回は数え直す。
 */
export async function changePassword(
  deps: LoginDeps,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const logFailure = (reason: string) =>
    deps.appLog.write({
      tenantId: input.tenantId,
      level: 'SECURITY',
      action: 'auth.password_change.failed',
      actorStaffId: input.staffId,
      details: { reason },
      ...input.meta,
    });

  const violation = checkPasswordPolicy(input.newPassword);
  if (violation) {
    await logFailure(`weak_password:${violation}`);
    return { ok: false, reason: 'weak_password', violation };
  }
  const account = await deps.uow.run(input.tenantId, async (r) => {
    const staff = await r.staff.findById(input.staffId);
    if (!staff) return null;
    const credentials = await r.staff.getCredentials(input.staffId);
    return credentials ? { staff, credentials } : null;
  });
  if (!account) {
    await logFailure('staff_not_found');
    return { ok: false, reason: 'invalid_session' };
  }

  const now = currentTime(deps);
  const rule = deps.rateLimits.passwordChangeFailureStaff;
  const limitKey = staffRateLimitKey(input.tenantId, input.staffId);
  // 照合の前に1回分の枠を取る(同時に送っても、照合まで進めるのは上限の回数まで)
  const decision = await deps.rateLimiter.consume(rule, limitKey, now);
  if (!decision.allowed) {
    await deps.appLog.write({
      tenantId: input.tenantId,
      level: 'WARN',
      action: 'auth.password_change.locked',
      actorStaffId: input.staffId,
      details: { rule: rule.name },
      ...input.meta,
    });
    return { ok: false, reason: 'locked', retryAfterMs: decision.retryAfterMs };
  }
  if ((await checkStaffPassword(deps, account.credentials, input.currentPassword)) === 'mismatch') {
    await logFailure('incorrect_current_password');
    if (decision.lockStarted) {
      await deps.appLog.write({
        tenantId: input.tenantId,
        level: 'WARN',
        action: 'auth.password_change.lockout_started',
        actorStaffId: input.staffId,
        details: { rule: rule.name },
        ...input.meta,
      });
    }
    return { ok: false, reason: 'incorrect_current_password' };
  }
  await deps.rateLimiter.reset(rule, limitKey);

  const passwordHash = await deps.passwordHasher.hash(input.newPassword);
  await deps.uow.run(input.tenantId, async (r) => {
    await r.staff.setPasswordHash(input.staffId, passwordHash);
    await r.sessions.revokeAllForStaff(input.staffId, now, input.sessionId);
  });
  await deps.appLog.write({
    tenantId: input.tenantId,
    level: 'SECURITY',
    action: 'auth.password_change.succeeded',
    actorStaffId: input.staffId,
    ...input.meta,
  });
  const deviceToken = issueDeviceToken(
    deps.deviceTrustSecret,
    {
      tenantId: input.tenantId,
      staffId: input.staffId,
      credentialVersion: deviceCredentialVersion(
        { passwordHash, legacyPasswordHash: null },
        account.staff.retiredOn,
      ),
    },
    now,
  );
  return { ok: true, deviceToken };
}
