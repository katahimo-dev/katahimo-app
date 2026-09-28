import {
  conflict,
  forbidden,
  LAST_ADMIN_MESSAGE,
  normalizeEmailForIndex,
  splitJapaneseFullName,
  splitJapaneseKana,
  zonedBusinessDate,
} from '../domain';
import type { Gender, StaffRole, TravelModeCode } from '../domain/model';
import type { StaffPatch } from '../ports/staff';
import type { TenantRepositories } from '../ports/unitOfWork';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

/**
 * 管理画面のスタッフの登録・更新(staffAdmin.ts)と xlsx の取込(staffAdminImport.ts)で共通の処理。
 * usecases の入口(index.ts)からは出さない。
 */

/** テナントのタイムゾーンの今日。 */
export async function todayOf(deps: Clock, r: TenantRepositories): Promise<string> {
  return zonedBusinessDate(currentTime(deps), (await r.tenant()).timezone);
}

/** スタッフID → 予定を読むカレンダー(staff_calendars の purpose = 'schedule')。 */
export async function scheduleCalendarsOf(r: TenantRepositories): Promise<Map<string, string>> {
  const calendars = new Map<string, string>();
  for (const c of await r.staffCalendars.listAll()) {
    if (c.purpose === 'schedule') calendars.set(c.staffId, c.calendarId);
  }
  return calendars;
}

/**
 * 在籍中の管理者の行をロックして(FOR UPDATE)確かめる: 操作する人自身がまだ在籍中の管理者か、removedAdminId
 * (管理者を外す・退職させる・削除する相手)を除いても、退職日の決まっていない管理者が1人は残るか。同時に互いを
 * 外しても管理者が残るように、管理者を減らす変更はこのロックの順に並ぶ。
 */
export async function assertAdminsRemain(
  r: TenantRepositories,
  actor: Actor,
  today: string,
  removedAdminId: string | null,
): Promise<void> {
  const admins = await r.staff.lockActiveAdmins(today);
  if (!admins.some((a) => a.id === actor.staffId)) throw forbidden('権限がありません。', 'actor_not_admin');
  if (!removedAdminId || !admins.some((a) => a.id === removedAdminId)) return;
  if (!admins.some((a) => a.id !== removedAdminId && a.retiredOn === null)) {
    throw conflict(LAST_ADMIN_MESSAGE, undefined, 'last_admin');
  }
}

/** 管理画面から登録・更新できるスタッフの項目(undefined は変えない、null は値なし)。 */
export interface StaffFieldsInput {
  name?: string | undefined;
  /** 「セイ メイ」。 */
  kana?: string | null | undefined;
  email?: string | undefined;
  altEmail?: string | null | undefined;
  phone?: string | null | undefined;
  role?: StaffRole | undefined;
  retiredOn?: string | null | undefined;
  travelMode?: TravelModeCode | null | undefined;
  gender?: Gender | null | undefined;
}

export const normalizedAltEmail = (value: string | null | undefined) =>
  value ? normalizeEmailForIndex(value) : null;

/**
 * 入力のうち staff の列で持つ項目を StaffPatch にする(氏名は姓・名に、カナは姓・名のカナに分け、メールは正規化する)。
 * 自宅(住所と緯度経度)・予定のカレンダーは呼び出し側で扱う。
 */
export function staffPatchOf(input: StaffFieldsInput): StaffPatch {
  const patch: StaffPatch = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const split = splitJapaneseFullName(name);
    Object.assign(patch, { displayName: name, familyName: split.familyName, givenName: split.givenName });
  }
  if (input.kana !== undefined) {
    Object.assign(
      patch,
      input.kana ? splitJapaneseKana(input.kana) : { familyNameKana: null, givenNameKana: null },
    );
  }
  if (input.email !== undefined) patch.email = normalizeEmailForIndex(input.email);
  if (input.altEmail !== undefined) patch.altEmail = normalizedAltEmail(input.altEmail);
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.role !== undefined) patch.role = input.role;
  if (input.retiredOn !== undefined) patch.retiredOn = input.retiredOn;
  if (input.travelMode !== undefined) patch.travelMode = input.travelMode;
  if (input.gender !== undefined) patch.gender = input.gender;
  return patch;
}

/** 退職日が今日以前になったスタッフのセッションを失効し、端末の通知の購読も消す(退職者の端末にお客様のお名前を送らない)。 */
export async function revokeRetiredStaffAccess(
  deps: Clock,
  r: TenantRepositories,
  staffId: string,
): Promise<void> {
  await r.sessions.revokeAllForStaff(staffId, currentTime(deps));
  await r.pushSubscriptions.deleteAllForStaff(staffId);
}
