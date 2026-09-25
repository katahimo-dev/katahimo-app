import type { PasswordPolicyViolation } from '@katahimo/shared';
import { checkPasswordPolicy } from '@katahimo/shared';
import type { RequestMeta } from '../requestMeta';
import type { AuthWithLogDeps } from './deps';
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
 * ログイン中スタッフ自身のパスワード変更。GAS版Auth.js changePasswordに対応。
 * 現在のパスワードはargon2id・レガシーハッシュのどちらでも検証し、新パスワードは常にargon2idで
 * 保存する。変更後は操作中のセッション以外を全て失効させる(他の端末に残ったログインを切るため)。
 */
export async function changePassword(
  deps: AuthWithLogDeps,
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

  const staff = await deps.staff.findById(input.tenantId, input.staffId);
  if (!staff) {
    await logFailure('staff_not_found');
    return { ok: false, reason: 'invalid_session' };
  }

  if ((await checkStaffPassword(deps, staff, input.currentPassword)) === 'mismatch') {
    await logFailure('incorrect_current_password');
    return { ok: false, reason: 'incorrect_current_password' };
  }

  await deps.staff.updatePasswordHash(
    input.tenantId,
    staff.id,
    await deps.passwordHasher.hash(input.newPassword),
  );
  await deps.sessions.deleteAllForStaff(input.tenantId, staff.id, input.sessionId);

  await deps.appLog.write({
    tenantId: input.tenantId,
    level: 'SECURITY',
    action: 'auth.password_change.succeeded',
    actorStaffId: staff.id,
    ...input.meta,
  });
  return { ok: true };
}
