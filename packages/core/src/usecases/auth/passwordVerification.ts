import { timingSafeEqual } from 'node:crypto';
import { computeLegacyHash } from '../../domain';
import type { StaffRecord } from '../../ports/repositories';
import type { AuthDeps } from './deps';

export type PasswordCheck = 'matched' | 'matched_legacy' | 'mismatch';

/** 同じ長さの文字列を、一致するまでの文字数で時間が変わらないように比較する。 */
function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * スタッフのパスワードを検証する。argon2idを優先し、まだargon2id化していない(GAS版から移行した)
 * スタッフはレガシーハッシュ(sha256(password + AUTH_SALT))でも検証する。
 * argon2idのハッシュが無いスタッフでも、ダミーの照合でargon2idと同じだけ時間をかける
 * (応答時間から移行前・パスワード未設定のアカウントを見分けられないようにする)。
 */
export async function checkStaffPassword(
  deps: Pick<AuthDeps, 'passwordHasher' | 'legacyAuthSalt'>,
  staff: Pick<StaffRecord, 'passwordHash' | 'legacyPasswordHash'>,
  password: string,
): Promise<PasswordCheck> {
  if (!password) return 'mismatch';
  if (staff.passwordHash) {
    if (await deps.passwordHasher.verify(staff.passwordHash, password)) return 'matched';
  } else {
    await deps.passwordHasher.verifyDummy(password);
  }
  if (staff.legacyPasswordHash && deps.legacyAuthSalt) {
    if (constantTimeEquals(computeLegacyHash(password, deps.legacyAuthSalt), staff.legacyPasswordHash)) {
      return 'matched_legacy';
    }
  }
  return 'mismatch';
}
