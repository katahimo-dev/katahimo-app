import { z } from 'zod';

/**
 * スタッフの役割。
 * - staff: 一般スタッフ(本人の予定・出勤簿・報告だけを扱う)
 * - coordinator: 他のスタッフの予定・出勤簿・報告も扱える(管理者設定・スタッフ管理はできない)
 * - admin: 管理者(全て)
 */
export const STAFF_ROLES = ['staff', 'coordinator', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const staffRoleSchema = z.enum(STAFF_ROLES);

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
