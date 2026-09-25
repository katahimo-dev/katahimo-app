import { computeLegacyHash } from '../../domain';
import type { StaffRecord } from '../../ports/repositories';
import type { AuthDeps } from './deps';

export type PasswordCheck = 'matched' | 'matched_legacy' | 'mismatch';

/**
 * スタッフのパスワードを検証する。argon2idを優先し、まだargon2id化していない(GAS版から移行した)
 * スタッフはレガシーハッシュ(sha256(password + AUTH_SALT))でも検証する。
 */
export async function checkStaffPassword(
  deps: Pick<AuthDeps, 'passwordHasher' | 'legacyAuthSalt'>,
  staff: Pick<StaffRecord, 'passwordHash' | 'legacyPasswordHash'>,
  password: string,
): Promise<PasswordCheck> {
  if (!password) return 'mismatch';
  if (staff.passwordHash && (await deps.passwordHasher.verify(staff.passwordHash, password))) {
    return 'matched';
  }
  if (staff.legacyPasswordHash && deps.legacyAuthSalt) {
    if (computeLegacyHash(password, deps.legacyAuthSalt) === staff.legacyPasswordHash) {
      return 'matched_legacy';
    }
  }
  return 'mismatch';
}
