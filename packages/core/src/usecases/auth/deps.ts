import type { AppLogPort } from '../../ports/appLog';
import type { MailerPort } from '../../ports/mailer';
import type { PasswordResetCodeRepositoryPort } from '../../ports/passwordResetCodes';
import type {
  SessionRepositoryPort,
  StaffRepositoryPort,
  TenantRepositoryPort,
} from '../../ports/repositories';

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
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

/** ログイン・セッション検証・パスワード変更。アプリログへの記録を伴う。 */
export interface AuthWithLogDeps extends AuthDeps {
  appLog: AppLogPort;
}

export interface PasswordResetDeps extends AuthWithLogDeps {
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  mailer: MailerPort;
  /**
   * 再設定コードのハッシュ(HMAC)に使うサーバー側の秘密値。6桁のコードは総当たりが容易なため、
   * DBが漏れてもこの値が無ければハッシュからコードを逆算できないようにする。
   */
  resetCodeSecret: string;
}

export function currentTime(deps: { now?: () => Date }): Date {
  return deps.now ? deps.now() : new Date();
}
