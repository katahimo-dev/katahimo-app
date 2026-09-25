import { createHash } from 'node:crypto';

/**
 * GAS版(gas-childcare-visit-app/Auth.js の computeHash)と同一のパスワードハッシュ計算。
 * `sha256(password + AUTH_SALT)` の16進(小文字)エンコード。
 *
 * GAS版はScript Properties一本の共有ソルト(AUTH_SALT)を全スタッフで使い回している
 * (スタッフごとの個別ソルトではない)。新システムは新規パスワードにargon2idを使うが、
 * 移行期は「既存パスワードのまま変更なしでログインできる」ことが要件のため、
 * ログイン時にこの関数で検証し、成功したらargon2idへサイレント再ハッシュする
 * (packages/core/src/usecases/auth.ts の login() 参照)。
 *
 * 移植時、GAS版のcomputeHashをNode上でそのまま実行した結果と本実装の出力が一致することを
 * 確認済み(CLAUDE.mdのLogic verificationに基づく検証手法)。
 */
export function computeLegacyHash(password: string, salt: string): string {
  if (!password) return '';
  if (!salt) throw new Error('レガシー認証用のソルト(LEGACY_AUTH_SALT)が設定されていません。');
  return createHash('sha256')
    .update(password + salt, 'utf8')
    .digest('hex');
}
