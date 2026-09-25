/**
 * パスワードの長さの規則。パスワード変更・再設定・管理者によるスタッフ登録で共通に使う
 * (サーバー側のusecaseとブラウザ側の入力チェックで同じ値を参照するためsharedに置く)。
 * GAS版には長さの制限が無かったが、推測されやすい短いパスワードを防ぐため下限を設ける。
 * 上限はargon2idへの過大な入力(サービス妨害)を避けるためのもの。
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordPolicyViolation = 'empty' | 'too_short' | 'too_long';

export function checkPasswordPolicy(password: string): PasswordPolicyViolation | null {
  if (!password) return 'empty';
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  return null;
}

export const PASSWORD_POLICY_MESSAGES: Record<PasswordPolicyViolation, string> = {
  empty: '新しいパスワードを入力してください',
  too_short: `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`,
  too_long: `パスワードは${PASSWORD_MAX_LENGTH}文字以内にしてください`,
};
