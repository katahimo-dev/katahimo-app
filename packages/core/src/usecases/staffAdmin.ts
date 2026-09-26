import type { AdminStaffView } from '@katahimo/shared';
import {
  conflict,
  forbidden,
  invalid,
  isRetiredOn,
  isStaffCalendarAllowed,
  newId,
  normalizeCalendarId,
  normalizeEmailForIndex,
  notFound,
  STALE_WRITE_MESSAGE,
  splitJapaneseFullName,
  splitJapaneseKana,
  zonedBusinessDate,
} from '../domain';
import type { Gender, StaffRole, TravelModeCode } from '../domain/model';
import type { AppLogPort } from '../ports/appLog';
import type { MapsPort } from '../ports/maps';
import type { RateLimiterPort } from '../ports/rateLimiter';
import type { StaffPasswordStatus, StaffPatch, StaffRecord } from '../ports/staff';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth';
import { issuePasswordResetCode } from './auth/passwordReset';
import { accountRateLimitKey, type RateLimitPolicy } from './rateLimits';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';
import { type HomeGeocodeStatus, type ResolvedStaffHome, resolveStaffHome } from './staffHome';

export type { AdminStaffView } from '@katahimo/shared';

export interface StaffAdminDeps extends Clock {
  uow: UnitOfWorkPort;
  passwordHasher: PasswordHasherPort;
  appLog: AppLogPort;
  /** 自宅住所のジオコーディング(地図APIを使わない環境では無し。住所だけを保存する)。 */
  maps?: MapsPort | undefined;
}

/** パスワード設定の案内メール(再設定コードの発行)に必要な依存。 */
export interface StaffPasswordGuideDeps extends StaffAdminDeps {
  resetCodeSecret: string;
  rateLimiter: RateLimiterPort;
  rateLimits: RateLimitPolicy;
}

/** 登録・更新の結果。homeGeocode は自宅住所をジオコーディングしたときの結果(それ以外は null)。 */
export interface AdminStaffWriteResult {
  staff: AdminStaffView;
  homeGeocode: HomeGeocodeStatus | null;
}

interface ViewContext {
  today: string;
  /** スタッフID → 予定を読むカレンダー。 */
  calendars: Map<string, string>;
  passwords: Map<string, StaffPasswordStatus>;
}

async function todayOf(deps: Clock, r: TenantRepositories): Promise<string> {
  return zonedBusinessDate(currentTime(deps), (await r.tenant()).timezone);
}

async function viewContext(deps: Clock, r: TenantRepositories): Promise<ViewContext> {
  const calendars = new Map<string, string>();
  for (const c of await r.staffCalendars.listAll()) {
    if (c.purpose === 'schedule') calendars.set(c.staffId, c.calendarId);
  }
  return { today: await todayOf(deps, r), calendars, passwords: await r.staff.listPasswordStatuses() };
}

function toView(staff: StaffRecord, context: ViewContext): AdminStaffView {
  return {
    id: staff.id,
    name: staff.displayName,
    kana: [staff.familyNameKana, staff.givenNameKana].filter(Boolean).join(' ') || null,
    email: staff.email,
    altEmail: staff.altEmail,
    phone: staff.phone,
    role: staff.role,
    retiredOn: staff.retiredOn,
    isRetired: isRetiredOn(staff.retiredOn, context.today),
    passwordStatus: context.passwords.get(staff.id) ?? 'unset',
    homeAddress: staff.homeAddress,
    hasHomeGeo: staff.homeGeo !== null,
    travelMode: staff.travelMode,
    gender: staff.gender,
    scheduleCalendarId: context.calendars.get(staff.id) ?? null,
    rowVersion: staff.rowVersion,
  };
}

async function loadView(deps: Clock, r: TenantRepositories, staffId: string): Promise<AdminStaffView> {
  const staff = await r.staff.findById(staffId);
  if (!staff) throw notFound('スタッフが見つかりません', 'not_found');
  return toView(staff, await viewContext(deps, r));
}

/** 管理者向けスタッフ一覧(退職者を含む、氏名順)。GAS版スタッフ台帳シートの閲覧に相当。 */
export function listStaffForAdmin(deps: StaffAdminDeps, tenantId: string): Promise<AdminStaffView[]> {
  return deps.uow.run(tenantId, async (r) => {
    const context = await viewContext(deps, r);
    return (await r.staff.listAll())
      .map((s) => toView(s, context))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  });
}

const EMAIL_CONFLICT = {
  email: 'このメールアドレスは他のスタッフが使用しています',
  altEmail: 'このサブメールは他のスタッフが使用しているか、メールアドレスと同じです',
} as const;

/** email / altEmail が他のスタッフと重なっていないか(DB の主キーでも弾かれるが、項目名つきの案内にする)。 */
async function assertEmailsFree(
  r: TenantRepositories,
  emails: { email: string; altEmail: string | null },
  selfId: string | null,
): Promise<void> {
  if (emails.altEmail && emails.altEmail === emails.email) {
    throw conflict(EMAIL_CONFLICT.altEmail, { altEmail: EMAIL_CONFLICT.altEmail }, 'email_conflict');
  }
  for (const field of ['email', 'altEmail'] as const) {
    const value = emails[field];
    if (!value) continue;
    const owner = await r.staff.findByLoginEmail(value);
    if (owner && owner.id !== selfId)
      throw conflict(EMAIL_CONFLICT[field], { [field]: EMAIL_CONFLICT[field] }, 'email_conflict');
  }
}

export const CALENDAR_NOT_ALLOWED_MESSAGE = 'このカレンダーは使えません。運用担当者に登録を依頼してください';

/**
 * スタッフに設定する予定のカレンダーが、テナントの許可の一覧(運用担当者が設定)に合うか。予定は全テナント共通の
 * Google の ID で読むため、合わないカレンダー(別のテナントのもの等)は設定させない。
 */
async function assertCalendarAllowed(r: TenantRepositories, calendarId: string): Promise<void> {
  if (!isStaffCalendarAllowed(await r.calendarSettings(), calendarId)) {
    throw invalid(
      CALENDAR_NOT_ALLOWED_MESSAGE,
      { scheduleCalendarId: CALENDAR_NOT_ALLOWED_MESSAGE },
      'calendar_not_allowed',
    );
  }
}

export const LAST_ADMIN_MESSAGE =
  '管理者が1人もいなくなるため、この操作はできません。先に別の管理者を決めてください';

/**
 * 在籍中の管理者の行をロックして(FOR UPDATE)確かめる: 操作する人自身がまだ在籍中の管理者か、removedAdminId
 * (管理者を外す・退職させる・削除する相手)を除いても、退職日の決まっていない管理者が1人は残るか。同時に互いを
 * 外しても管理者が残るように、管理者を減らす変更はこのロックの順に並ぶ。
 */
async function assertAdminsRemain(
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

/** 管理画面から登録・更新できるスタッフの項目(null は値なし)。 */
interface StaffProfileInput {
  /** 「セイ メイ」。 */
  kana?: string | null | undefined;
  altEmail?: string | null | undefined;
  phone?: string | null | undefined;
  homeAddress?: string | null | undefined;
  travelMode?: TravelModeCode | null | undefined;
  gender?: Gender | null | undefined;
  scheduleCalendarId?: string | null | undefined;
}

export interface CreateStaffInput extends StaffProfileInput {
  name: string;
  email: string;
  role: StaffRole;
  /** 省略時はパスワード未設定(本人がパスワード再設定で初回設定する)。 */
  initialPassword?: string | undefined;
}

export interface UpdateStaffInput extends StaffProfileInput {
  name?: string | undefined;
  email?: string | undefined;
  role?: StaffRole | undefined;
  retiredOn?: string | null | undefined;
  /** 読んだときの版。渡すと、その後に他の管理者が更新していれば conflict。 */
  rowVersion?: number | undefined;
}

/** 入力のうち staff の列で持つ項目(氏名・カナ・電話・移動手段・性別)を StaffPatch にする。 */
function profilePatch(input: StaffProfileInput & { name?: string | undefined }): StaffPatch {
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
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
  if (input.travelMode !== undefined) patch.travelMode = input.travelMode;
  if (input.gender !== undefined) patch.gender = input.gender;
  return patch;
}

const normalizedAltEmail = (value: string | null | undefined) =>
  value ? normalizeEmailForIndex(value) : null;

/** 断った操作の WARN(理由コードのある DomainError だけ。想定外の例外は API の要求ログに残る)。 */
async function logRejected(
  deps: StaffAdminDeps,
  actor: Actor,
  action: string,
  error: unknown,
  targetStaffId: string | null,
) {
  const reason = (error as { reason?: string } | null)?.reason;
  if (!reason) return;
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'WARN',
    action,
    actorStaffId: actor.staffId,
    targetStaffId: reason === 'not_found' ? null : targetStaffId,
    details: { reason },
    ...actor.meta,
  });
}

/** 管理者によるスタッフの新規登録(自宅住所はトランザクションの前にジオコーディングする)。 */
export async function createStaffByAdmin(
  deps: StaffAdminDeps,
  actor: Actor,
  input: CreateStaffInput,
): Promise<AdminStaffWriteResult> {
  const email = normalizeEmailForIndex(input.email);
  const altEmail = normalizedAltEmail(input.altEmail);
  const calendarId = input.scheduleCalendarId ? normalizeCalendarId(input.scheduleCalendarId) : null;
  const staffId = newId();
  try {
    await deps.uow.run(actor.tenantId, async (r) => {
      await assertEmailsFree(r, { email, altEmail }, null);
      if (calendarId) await assertCalendarAllowed(r, calendarId);
    });
    const resolved = input.homeAddress ? await resolveStaffHome(deps.maps, input.homeAddress) : null;
    const passwordHash = input.initialPassword ? await deps.passwordHasher.hash(input.initialPassword) : null;
    const patch = profilePatch(input);
    const staff = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        if (calendarId) await assertCalendarAllowed(r, calendarId);
        await r.staff.create({
          id: staffId,
          displayName: patch.displayName ?? '',
          familyName: patch.familyName ?? '',
          givenName: patch.givenName ?? '',
          familyNameKana: patch.familyNameKana ?? null,
          givenNameKana: patch.givenNameKana ?? null,
          email,
          altEmail,
          phone: patch.phone ?? null,
          role: input.role,
          travelMode: patch.travelMode ?? null,
          gender: patch.gender ?? null,
          ...(resolved ? { home: resolved.home } : {}),
          passwordHash,
        });
        if (calendarId) await r.staffCalendars.setScheduleCalendar(staffId, calendarId, newId());
        return loadView(deps, r, staffId);
      },
      { actorId: actor.staffId },
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'staff.admin.created',
      actorStaffId: actor.staffId,
      targetStaffId: staffId,
      details: {
        role: staff.role,
        initialPasswordSet: passwordHash !== null,
        ...(resolved ? { homeGeocode: resolved.geocode } : {}),
      },
      ...actor.meta,
    });
    return { staff, homeGeocode: resolved?.geocode ?? null };
  } catch (error) {
    await logRejected(deps, actor, 'staff.admin.create_rejected', error, null);
    throw error;
  }
}

/**
 * 更新の前の確かめ(トランザクションの外、地図APIを呼ぶ前): 版が古くないか。自宅住所が変わる、または住所は
 * そのままでも緯度経度が無いなら、ここでジオコーディングしておく(それ以外は null)。
 */
async function prepareUpdate(
  deps: StaffAdminDeps,
  tenantId: string,
  staffId: string,
  input: UpdateStaffInput,
): Promise<ResolvedStaffHome | null> {
  const current = await deps.uow.run(tenantId, (r) => r.staff.findById(staffId));
  if (!current) throw notFound('スタッフが見つかりません', 'not_found');
  if (input.rowVersion !== undefined && input.rowVersion !== current.rowVersion) {
    throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
  }
  if (input.homeAddress === undefined) return null;
  const next = input.homeAddress?.trim() || null;
  if (next === current.homeAddress && (next === null || current.homeGeo !== null)) return null;
  return resolveStaffHome(deps.maps, next);
}

/**
 * 管理者によるスタッフ情報の更新。自分自身の管理者権限の解除・退職日の設定は拒否し、管理者を外す・退職させる変更は
 * 在籍中の管理者の行をロックしてから行う(同時に互いを外しても管理者が残るように)。今日の時点で退職している
 * 退職日を入れたら、そのスタッフのセッションを失効させる(先の日付なら、その日からログインできなくなる)。
 * 自宅住所を変えたら緯度経度も置き換える(ジオコーディングできなければ空にし、ルート計算は住所で行う)。
 */
export async function updateStaffByAdmin(
  deps: StaffAdminDeps,
  actor: Actor,
  staffId: string,
  input: UpdateStaffInput,
): Promise<AdminStaffWriteResult> {
  try {
    if (staffId === actor.staffId && input.role !== undefined && input.role !== 'admin') {
      throw invalid('自分自身の管理者権限は解除できません', undefined, 'cannot_demote_self');
    }
    if (staffId === actor.staffId && input.retiredOn) {
      throw invalid('自分自身に退職日は設定できません', undefined, 'cannot_retire_self');
    }
    const resolved = await prepareUpdate(deps, actor.tenantId, staffId, input);
    const staff = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const today = await todayOf(deps, r);
        const removesAdmin = (input.role !== undefined && input.role !== 'admin') || Boolean(input.retiredOn);
        await assertAdminsRemain(r, actor, today, removesAdmin ? staffId : null);
        const current = await r.staff.findById(staffId);
        if (!current) throw notFound('スタッフが見つかりません', 'not_found');
        const patch = profilePatch(input);
        if (input.email !== undefined) patch.email = normalizeEmailForIndex(input.email);
        if (input.altEmail !== undefined) patch.altEmail = normalizedAltEmail(input.altEmail);
        if (input.role !== undefined) patch.role = input.role;
        if (input.retiredOn !== undefined) patch.retiredOn = input.retiredOn;
        if (resolved) patch.home = resolved.home;
        await assertEmailsFree(
          r,
          {
            email: patch.email ?? current.email,
            altEmail: patch.altEmail !== undefined ? patch.altEmail : current.altEmail,
          },
          staffId,
        );
        const calendarId =
          input.scheduleCalendarId === undefined
            ? undefined
            : input.scheduleCalendarId
              ? normalizeCalendarId(input.scheduleCalendarId)
              : null;
        const currentCalendar =
          (await r.staffCalendars.listAll()).find((c) => c.staffId === staffId && c.purpose === 'schedule')
            ?.calendarId ?? null;
        const calendarChanged = calendarId !== undefined && calendarId !== currentCalendar;
        if (calendarChanged && calendarId) await assertCalendarAllowed(r, calendarId);
        const updated = await r.staff.update(staffId, patch, input.rowVersion);
        if (!updated) throw notFound('スタッフが見つかりません', 'not_found');
        if (calendarChanged) await r.staffCalendars.setScheduleCalendar(staffId, calendarId ?? null, newId());
        if (patch.retiredOn && isRetiredOn(patch.retiredOn, today)) {
          await r.sessions.revokeAllForStaff(staffId, currentTime(deps));
        }
        return loadView(deps, r, staffId);
      },
      { actorId: actor.staffId },
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'staff.admin.updated',
      actorStaffId: actor.staffId,
      targetStaffId: staffId,
      details: {
        changedFields: Object.keys(input).filter((key) => key !== 'rowVersion'),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.retiredOn !== undefined ? { retiredOn: input.retiredOn } : {}),
        ...(resolved ? { homeGeocode: resolved.geocode } : {}),
      },
      ...actor.meta,
    });
    return { staff, homeGeocode: resolved?.geocode ?? null };
  } catch (error) {
    await logRejected(deps, actor, 'staff.admin.update_rejected', error, staffId);
    throw error;
  }
}

/** 業務の記録があって削除できないときの案内。 */
export const STAFF_HAS_RECORDS_MESSAGE =
  'このスタッフには出勤簿・報告・領収書などの記録があるため削除できません。辞めた方は退職日を設定してください。';

/**
 * 管理者によるスタッフの削除。間違えて登録したスタッフを消すためのもので、業務の記録(出勤簿・報告・領収書・
 * 変更の履歴等)が1件でもあれば消さずに conflict にする(記録を残したまま使えなくするのは退職日)。自分自身・
 * 最後の管理者は削除できない。
 */
export async function deleteStaffByAdmin(deps: StaffAdminDeps, actor: Actor, staffId: string): Promise<void> {
  try {
    if (staffId === actor.staffId) {
      throw invalid('自分自身は削除できません', undefined, 'cannot_delete_self');
    }
    await deps.uow.run(
      actor.tenantId,
      async (r) => {
        await assertAdminsRemain(r, actor, await todayOf(deps, r), staffId);
        const outcome = await r.staff.deleteIfUnreferenced(staffId);
        if (outcome === 'not_found') throw notFound('スタッフが見つかりません', 'not_found');
        if (outcome === 'referenced')
          throw conflict(STAFF_HAS_RECORDS_MESSAGE, undefined, 'staff_has_records');
      },
      { actorId: actor.staffId },
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'staff.admin.deleted',
      actorStaffId: actor.staffId,
      targetStaffId: staffId,
      ...actor.meta,
    });
  } catch (error) {
    await logRejected(deps, actor, 'staff.admin.delete_rejected', error, staffId);
    throw error;
  }
}

export type PasswordGuideOutcome = { status: 'queued' } | { status: 'rate_limited'; retryAfterMs: number };

/**
 * パスワード未設定・GAS版のパスワードのままのスタッフに、パスワード設定の案内(再設定コード)をメールで送る。
 * 本人の「パスワードを忘れたとき」と同じコード・同じ outbox の送信を使う。回数の上限は本人の再設定の要求と共有する
 * (その人のログイン用メール(主・サブ)それぞれの枠を数え、どれかが上限なら送らない)。送り先はメールアドレス(主)。
 */
export async function sendPasswordGuideByAdmin(
  deps: StaffPasswordGuideDeps,
  actor: Actor,
  staffId: string,
): Promise<PasswordGuideOutcome> {
  const now = currentTime(deps);
  try {
    const { staff, tenantSlug } = await deps.uow.run(actor.tenantId, async (r) => {
      const view = await loadView(deps, r, staffId);
      if (view.isRetired) throw invalid('退職したスタッフには送れません', undefined, 'retired');
      if (view.passwordStatus === 'set') {
        throw invalid(
          'このスタッフはパスワードを設定済みです。忘れたときは本人が「パスワードを忘れたときはこちら」から設定し直せます',
          undefined,
          'password_already_set',
        );
      }
      return { staff: view, tenantSlug: (await r.tenant()).slug };
    });
    for (const loginId of [staff.email, staff.altEmail]) {
      if (!loginId) continue;
      const limit = await deps.rateLimiter.consume(
        deps.rateLimits.passwordResetRequestAccount,
        accountRateLimitKey(tenantSlug, loginId),
        now,
      );
      if (!limit.allowed) {
        await logRejected(
          deps,
          actor,
          'staff.admin.password_guide_rejected',
          { reason: 'rate_limited' },
          staffId,
        );
        return { status: 'rate_limited', retryAfterMs: limit.retryAfterMs };
      }
    }
    await issuePasswordResetCode(
      deps,
      actor.tenantId,
      { staffId, sentTo: staff.email, purpose: 'setup_guide' },
      now,
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'staff.admin.password_guide_sent',
      actorStaffId: actor.staffId,
      targetStaffId: staffId,
      details: { passwordStatus: staff.passwordStatus },
      ...actor.meta,
    });
    return { status: 'queued' };
  } catch (error) {
    await logRejected(deps, actor, 'staff.admin.password_guide_rejected', error, staffId);
    throw error;
  }
}
