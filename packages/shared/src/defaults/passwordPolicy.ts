/**
 * パスワードの長さの規則。パスワード変更・再設定・管理者によるスタッフ登録で共通に使う
 * (サーバー側のusecaseとブラウザ側の入力チェックで同じ値を参照するためsharedに置く)。
 * GAS版には長さの制限が無かったが、推測されやすい短いパスワードを防ぐため下限を設ける。
 * 上限はargon2idへの過大な入力(サービス妨害)を避けるためのもの。
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * パスワード再設定コードの桁数(メールで届く数字)。GAS版の6桁から8桁にした(1つのコードへの入力の上限・
 * 回数制限と合わせて、総当たりで当たる見込みを1/100にする)。
 */
export const PASSWORD_RESET_CODE_LENGTH = 8;

/**
 * 受け付ける再設定コードの形。8桁のほか、移行のあいだだけ6桁も受け付ける(この版を出す前に発行した6桁のコードは
 * 30分で切れるため、次のリリースで6桁を外す)。
 */
export const PASSWORD_RESET_CODE_PATTERN = /^(?:\d{8}|\d{6})$/;

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
