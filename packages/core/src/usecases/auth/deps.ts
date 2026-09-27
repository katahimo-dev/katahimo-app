import type { AppLogPort } from '../../ports/appLog';
import type { RateLimiterPort } from '../../ports/rateLimiter';
import type { TenantDirectoryPort } from '../../ports/tenants';
import type { UnitOfWorkPort } from '../../ports/unitOfWork';
import type { RateLimitPolicy } from '../rateLimits';
import type { Clock } from '../requestMeta';

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /**
   * 照合相手のハッシュが無いとき(テナント・アカウントが無い、パスワード未設定)に、verify と同じだけ
   * 時間をかけて空振りする。応答時間の差からアカウントの有無を推測されないようにするため。
   */
  verifyDummy(password: string): Promise<void>;
}

/** スタッフ登録(registerStaff)に必要な依存。 */
export interface StaffRegistrationDeps {
  uow: UnitOfWorkPort;
  passwordHasher: PasswordHasherPort;
}

export interface AuthDeps extends StaffRegistrationDeps, Clock {
  tenants: TenantDirectoryPort;
  appLog: AppLogPort;
  /**
   * GAS版 Script Properties の AUTH_SALT と同じ値。GAS版から移行したスタッフ(legacy_password_hash だけを持つ)の
   * 初回ログインにだけ使う。
   */
  legacyAuthSalt?: string | undefined;
}

/** ログイン。失敗回数によるアカウント・送信元IP単位の一時ロックを伴う。 */
export interface LoginDeps extends AuthDeps {
  rateLimiter: RateLimiterPort;
  rateLimits: RateLimitPolicy;
}

export interface PasswordResetDeps extends LoginDeps {
  /**
   * 再設定コードのハッシュ(HMAC)に使うサーバー側の秘密値(SESSION_SECRET から HKDF で導出した専用の鍵)。
   * 6桁のコードは総当たりが容易なため、DBが漏れてもこの値が無ければハッシュからコードを逆算できない。
   */
  resetCodeSecret: string;
  /**
   * outbox の処理の起動の依頼(API の OutboxDrainNotifier)。再設定コードを積んだ要求は UoW のコミットの後に起動を頼むため、
   * 積まなかった要求(アカウントが無い・アカウント単位の上限)でも同じだけ頼み、応答時間からアカウントの有無を分からなくする。
   */
  outboxDrain?: { notify(): Promise<void> };
}
