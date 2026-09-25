/**
 * クラス名をつなぐ(false / null / undefined は飛ばす)。GAS版がJSで付け外ししていたクラス(hidden 等)を、
 * 状態に応じて同じ順番で付けるために使う。
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
