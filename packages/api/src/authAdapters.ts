import { randomBytes } from 'node:crypto';
import type { PasswordHasherPort } from '@katahimo/core/usecases';
import { hash, verify } from '@node-rs/argon2';

/** verifyDummy が照合に使うハッシュ(初回に1回だけ作る。誰のパスワードでもない乱数のハッシュ)。 */
let dummyHash: Promise<string> | null = null;

/** PasswordHasherPortのargon2id実装。 */
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
  async verifyDummy(password) {
    dummyHash ??= hash(randomBytes(32).toString('hex'));
    await verify(await dummyHash, password || ' ').catch(() => false);
  },
};
