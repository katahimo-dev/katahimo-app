import type { AppLogPort } from '../../ports/appLog';
import type { CryptoPort } from '../../ports/crypto';
import type { MirrorPort } from '../../ports/mirror';
import type { PasswordResetCodeRepositoryPort } from '../../ports/passwordResetCodes';
import type { RateLimiterPort } from '../../ports/rateLimiter';
import type {
  SessionRepositoryPort,
  StaffRepositoryPort,
  TenantRepositoryPort,
} from '../../ports/repositories';
import type { RateLimitPolicy } from '../rateLimits';

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /**
   * 照合相手のハッシュが無いとき(テナント・アカウントが無い、パスワード未設定)に、verifyと同じだけ
   * 時間をかけて空振りする。応答時間の差からアカウントの有無を推測されないようにするため。
   */
  verifyDummy(password: string): Promise<void>;
}

/** スタッフ登録(registerStaff/importLegacyStaff)に必要な最小限の依存。 */
export interface StaffRegistrationDeps {
  staff: StaffRepositoryPort;
  passwordHasher: PasswordHasherPort;
}

export interface AuthDeps extends StaffRegistrationDeps {
  tenants: TenantRepositoryPort;
  sessions: SessionRepositoryPort;
  /**
   * GAS版Script Properties AUTH_SALTと同じ値。既存スタッフがパスワード変更なしでログイン
   * できるようにするための移行専用の値で、未設定でも新規登録スタッフのログインには影響しない
   * (legacyPasswordHashを持つスタッフだけがこれを必要とする)。
   */
  legacyAuthSalt?: string;
  /** 現在時刻(テスト用に差し替えられるようにしている)。省略時は実時刻。 */
  now?: () => Date;
}

/** セッション検証・パスワード変更。アプリログへの記録を伴う。 */
export interface AuthWithLogDeps extends AuthDeps {
  appLog: AppLogPort;
}

/** ログイン。失敗回数によるアカウント・送信元IP単位の一時ロックを伴う。 */
export interface LoginDeps extends AuthWithLogDeps {
  rateLimiter: RateLimiterPort;
  rateLimits: RateLimitPolicy;
}

export interface PasswordResetDeps extends LoginDeps {
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  /** 送信待ちのコードの暗号化。 */
  crypto: CryptoPort;
  /** 再設定メールの送信ジョブ(kind='password_reset_mail')を積むoutbox。送信はワーカーが行う。 */
  mailOutbox: MirrorPort;
  /**
   * 再設定コードのハッシュ(HMAC)に使うサーバー側の秘密値(SESSION_SECRETからHKDFで導出した専用の鍵)。
   * 6桁のコードは総当たりが容易なため、DBが漏れてもこの値が無ければハッシュからコードを逆算できない
   * ようにする。
   */
  resetCodeSecret: string;
}

export function currentTime(deps: { now?: () => Date }): Date {
  return deps.now ? deps.now() : new Date();
}
