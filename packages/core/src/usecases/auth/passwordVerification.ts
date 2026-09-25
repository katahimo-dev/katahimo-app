import { timingSafeEqual } from 'node:crypto';
import { computeLegacyHash } from '../../domain';
import type { StaffCredentials } from '../../ports/staff';
import type { AuthDeps } from './deps';

export type PasswordCheck = 'matched' | 'matched_legacy' | 'mismatch';

/** 同じ長さの文字列を、一致するまでの文字数で時間が変わらないように比較する。 */
function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * パスワードを検証する。argon2id を優先し、まだ移行していない(GAS版から来た)スタッフはレガシーハッシュ
 * (sha256(password + AUTH_SALT))でも検証する。argon2id のハッシュが無くても同じだけ時間をかける。
 */
export async function checkStaffPassword(
  deps: Pick<AuthDeps, 'passwordHasher' | 'legacyAuthSalt'>,
  credentials: StaffCredentials | null,
  password: string,
): Promise<PasswordCheck> {
  if (!password) return 'mismatch';
  if (credentials?.passwordHash) {
    if (await deps.passwordHasher.verify(credentials.passwordHash, password)) return 'matched';
  } else {
    await deps.passwordHasher.verifyDummy(password);
  }
  if (credentials?.legacyPasswordHash && deps.legacyAuthSalt) {
    if (
      constantTimeEquals(computeLegacyHash(password, deps.legacyAuthSalt), credentials.legacyPasswordHash)
    ) {
      return 'matched_legacy';
    }
  }
  return 'mismatch';
}
