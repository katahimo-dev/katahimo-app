import type { PasswordHasherPort } from '@katahimo/core/usecases';
import { hash, verify } from '@node-rs/argon2';

/** PasswordHasherPortのargon2id実装。GAS版のSHA-256+salt方式からの移行はPhase 2で別途扱う。 */
export const argon2PasswordHasher: PasswordHasherPort = {
  async hash(password) {
    return hash(password);
  },
  async verify(passwordHash, password) {
    try {
      return await verify(passwordHash, password);
    } catch {
      // ハッシュ形式が不正(移行前のレガシーハッシュ等)な場合はverifyが例外を投げるため、
      // 「不一致」として扱う(認証エラーにするが、内部エラーとしては落とさない)。
      return false;
    }
  },
};
