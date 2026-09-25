/**
 * 予定の件名から、お客様一覧の1件を探す(GAS版 findCustomerByScheduleName_)。
 * サーバーの顧客の突き合わせと同じく、空白をすべて取りのぞいてから完全一致で見比べ、
 * ちょうど1件に決まったときだけ返す。部分一致で開くと別のお客様の日報を書いてしまうおそれが
 * あるため、決められないときは null(呼び出し側がお客様一覧へ案内する)。
 */
export function findCustomerByScheduleName<T extends { name: string }>(
  customers: readonly T[],
  scheduleName: string,
): T | null {
  const normalize = (s: string) => String(s || '').replace(/\s+/g, '');
  const name = normalize(scheduleName);
  if (!name) return null;
  const exact = customers.filter((c) => normalize(c.name) === name);
  return exact.length === 1 ? (exact[0] ?? null) : null;
}
