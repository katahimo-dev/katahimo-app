/**
 * スタッフ名の表記ゆれ吸収。
 *
 * 移植元: gas-childcare-visit-app/RouteSearch.js の normalizeStaffName_()
 * カレンダー予定・スタッフ台帳・出勤簿で全角/半角スペースやタブの入り方が揃っておらず、
 * 名前で突き合わせる箇所は必ずこれを通す、という運用で磨かれたロジック。
 *
 * 注意: 新システムでは氏名の文字列一致による顧客・スタッフの紐付けは external_ids に置き換える。
 * この関数は「移行期に旧データと突き合わせる」ためのものであり、新規の紐付けキーには使わない。
 */
export function normalizeStaffName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '');
}

/** 表記ゆれを無視した同一判定。 */
export function isSameStaffName(a: unknown, b: unknown): boolean {
  const na = normalizeStaffName(a);
  return na !== '' && na === normalizeStaffName(b);
}
