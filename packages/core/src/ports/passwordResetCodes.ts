/**
 * パスワード再設定コード(password_reset_codesテーブル)のポート。コードそのものは保存せず、
 * ハッシュだけを扱う。有効期限・試行回数・使用済みの判定はusecase(usecases/auth/passwordReset.ts)が行う。
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
}

export interface NewPasswordResetCodeInput {
  tenantId: string;
  staffId: string;
  codeHash: string;
  sentToEmail: string;
  expiresAt: Date;
}

export interface PasswordResetCodeRepositoryPort {
  /**
   * 同じスタッフの未使用コードを全て使用済みにしてから、新しいコードを1件作る
   * (有効なコードが常に高々1件になるようにする)。
   */
  replaceActive(input: NewPasswordResetCodeInput, now: Date): Promise<PasswordResetCodeRecord>;
  /** 未使用(usedAtがnull)のうち最も新しいコード。期限切れでも返す(期限切れの旨を伝えるため)。 */
  findLatestUnused(tenantId: string, staffId: string): Promise<PasswordResetCodeRecord | null>;
  /** since以降に発行されたコードの件数(発行回数の上限判定用)。 */
  countIssuedSince(tenantId: string, staffId: string, since: Date): Promise<number>;
  /** 誤入力回数を1増やし、増やした後の値を返す。 */
  incrementAttempts(tenantId: string, id: string): Promise<number>;
  markUsed(tenantId: string, id: string, usedAt: Date): Promise<void>;
}
