/**
 * メールアドレスの正規化。
 * staff.emailはログイン時の検索キー(等値一致)になるため、大文字小文字・前後空白の表記ゆれで
 * 一致しなくならないよう、書き込み時・検索時の両方でこの関数を通した値を使う
 * (packages/core/src/usecases/auth.ts参照)。
 */
export function normalizeEmailForIndex(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}
