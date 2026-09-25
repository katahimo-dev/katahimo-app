import type { EncryptedValue } from './crypto';

/**
 * パスワード再設定コード(password_reset_codesテーブル)のポート。照合にはコードのハッシュだけを使う。
 * 有効期限・試行回数の判定はusecase(usecases/auth/passwordReset.ts)が行うが、誤入力回数の加算と
 * 使用済みへの遷移は並列リクエストでも上限を超えないよう、実装が1文の条件付き更新で原子的に行う。
 */
export interface PasswordResetCodeRecord {
  id: string;
  tenantId: string;
  staffId: string;
  codeHash: string;
  sentToEmail: string;
  expiresAt: Date;
  usedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
  /** メール送信待ちのコード(暗号化済み)。送信後・使用後はnull。 */
  mailCode: EncryptedValue | null;
}

export interface NewPasswordResetCodeInput {
  tenantId: string;
  staffId: string;
  codeHash: string;
  sentToEmail: string;
  expiresAt: Date;
  /** ワーカーがメールを送るまでの間だけ保持するコード(CryptoPortで暗号化したもの)。 */
  mailCode: EncryptedValue;
}

export interface PasswordResetCodeRepositoryPort {
  /**
   * 同じスタッフの未使用コードを全て使用済みにしてから、新しいコードを1件作る
   * (有効なコードが常に高々1件になるようにする)。
   */
  replaceActive(input: NewPasswordResetCodeInput, now: Date): Promise<PasswordResetCodeRecord>;
  /** 未使用(usedAtがnull)のうち最も新しいコード。期限切れでも返す(期限切れの旨を伝えるため)。 */
  findLatestUnused(tenantId: string, staffId: string): Promise<PasswordResetCodeRecord | null>;
  findById(tenantId: string, id: string): Promise<PasswordResetCodeRecord | null>;
  /**
   * 試行1回分を原子的に記録する: 未使用・期限内・試行回数がmaxAttempts未満のときだけ試行回数を1増やし、
   * 増やした後の行を返す。条件を満たさなければ何も変えずにnull(並列リクエストでも上限を超えない)。
   */
  registerAttempt(
    tenantId: string,
    id: string,
    maxAttempts: number,
    now: Date,
  ): Promise<PasswordResetCodeRecord | null>;
  /**
   * コードを使用済みにする(1回限りの利用)。未使用だった場合だけ更新してtrue、既に使用済みならfalse
   * (同じコードでの同時の再設定を1件だけ成功させる)。送信待ちのコードも消す。
   */
  consume(tenantId: string, id: string, now: Date): Promise<boolean>;
  /** コードを無効にする(誤入力の上限・期限切れ)。送信待ちのコードも消す。 */
  markUsed(tenantId: string, id: string, usedAt: Date): Promise<void>;
  /** メール送信後に、送信待ちのコードを消す。 */
  clearMailCode(tenantId: string, id: string): Promise<void>;
}
