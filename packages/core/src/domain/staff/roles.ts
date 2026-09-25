import type { StaffRole } from '../model';

/** 管理者(管理者設定・スタッフ管理・顧客CSVの取込・勤怠集計の書き直しができる)。 */
export function isAdminRole(role: StaffRole): boolean {
  return role === 'admin';
}

/**
 * 他のスタッフの予定・出勤簿・報告を扱えるか(管理者とコーディネーター)。一般スタッフは常に本人の分だけ
 * (GAS版の「管理者だけが対象スタッフを選べる」規則をコーディネーターに広げたもの)。
 */
export function canActForOthers(role: StaffRole): boolean {
  return role === 'admin' || role === 'coordinator';
}

/**
 * 操作の対象スタッフ。他人を扱えないロールは要求にかかわらず本人、扱えるロールは指定があればそのスタッフ
 * (クライアントが送ったスタッフIDを一般スタッフには決して使わない。CLAUDE.md の admin-vs-self)。
 */
export function resolveTargetStaffId(
  actor: { staffId: string; role: StaffRole },
  requestedStaffId: string | null | undefined,
): string {
  if (!canActForOthers(actor.role)) return actor.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || actor.staffId;
}
