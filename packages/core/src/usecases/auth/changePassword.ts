import type { PasswordPolicyViolation } from '@katahimo/shared';
import { checkPasswordPolicy } from '@katahimo/shared';
import type { RequestMeta } from '../requestMeta';
import { currentTime } from '../requestMeta';
import type { AuthDeps } from './deps';
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
  | { ok: true }
  | { ok: false; reason: 'invalid_session' | 'incorrect_current_password' }
  | { ok: false; reason: 'weak_password'; violation: PasswordPolicyViolation };

/**
 * ログイン中のスタッフ自身のパスワード変更(GAS版 Auth.js changePassword)。現在のパスワードは argon2id・
 * レガシーハッシュのどちらでも確かめ、新しいパスワードは argon2id で保存する。変更後は操作中のセッション以外を
 * 全て失効させる(他の端末に残ったログインを切る)。
 */
export async function changePassword(
  deps: AuthDeps,
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
  const credentials = await deps.uow.run(input.tenantId, async (r) =>
    (await r.staff.findById(input.staffId)) ? r.staff.getCredentials(input.staffId) : null,
  );
  if (!credentials) {
    await logFailure('staff_not_found');
    return { ok: false, reason: 'invalid_session' };
  }
  if ((await checkStaffPassword(deps, credentials, input.currentPassword)) === 'mismatch') {
    await logFailure('incorrect_current_password');
    return { ok: false, reason: 'incorrect_current_password' };
  }
  const passwordHash = await deps.passwordHasher.hash(input.newPassword);
  const now = currentTime(deps);
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
  return { ok: true };
}
