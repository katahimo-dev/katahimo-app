import {
  conflict,
  invalid,
  isRetiredOn,
  newId,
  normalizeEmailForIndex,
  notFound,
  splitJapaneseFullName,
  splitJapaneseKana,
  zonedBusinessDate,
} from '../domain';
import type { Gender, StaffRole, TravelModeCode } from '../domain/model';
import type { AppLogPort } from '../ports/appLog';
import type { MapsPort } from '../ports/maps';
import type { RateLimiterPort } from '../ports/rateLimiter';
import type { StaffPatch, StaffRecord } from '../ports/staff';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth';
import { issuePasswordResetCode } from './auth/passwordReset';
import { accountRateLimitKey, type RateLimitPolicy } from './rateLimits';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';
import { type HomeGeocodeStatus, type ResolvedStaffHome, resolveStaffHome } from './staffHome';

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

export interface AdminStaffView {
  id: string;
  name: string;
  kana: string | null;
  email: string;
  altEmail: string | null;
  phone: string | null;
  role: StaffRole;
  retiredOn: string | null;
  isRetired: boolean;
  passwordStatus: 'set' | 'legacy' | 'unset';
  homeAddress: string | null;
  hasHomeGeo: boolean;
  travelMode: TravelModeCode | null;
  gender: Gender | null;
  scheduleCalendarId: string | null;
  rowVersion: number;
}

/** 登録・更新の結果。homeGeocode は自宅住所を登録・変更したときのジオコーディングの結果(それ以外は null)。 */
export interface AdminStaffWriteResult {
  staff: AdminStaffView;
  homeGeocode: HomeGeocodeStatus | null;
}

interface ViewContext {
  today: string;
  /** スタッフID → 予定を読むカレンダー。 */
  calendars: Map<string, string>;
}

async function viewContext(deps: Clock, r: TenantRepositories): Promise<ViewContext> {
  const calendars = new Map<string, string>();
  for (const c of await r.staffCalendars.listAll()) {
    if (c.purpose === 'schedule') calendars.set(c.staffId, c.calendarId);
  }
  return { today: zonedBusinessDate(currentTime(deps), (await r.tenant()).timezone), calendars };
}

async function toView(
  r: TenantRepositories,
  staff: StaffRecord,
  context: ViewContext,
): Promise<AdminStaffView> {
  const credentials = await r.staff.getCredentials(staff.id);
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
    passwordStatus: credentials?.passwordHash ? 'set' : credentials?.legacyPasswordHash ? 'legacy' : 'unset',
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
  return toView(r, staff, await viewContext(deps, r));
}

/** 管理者向けスタッフ一覧(退職者を含む、氏名順)。GAS版スタッフ台帳シートの閲覧に相当。 */
export function listStaffForAdmin(deps: StaffAdminDeps, tenantId: string): Promise<AdminStaffView[]> {
  return deps.uow.run(tenantId, async (r) => {
    const context = await viewContext(deps, r);
    const views = await Promise.all((await r.staff.listAll()).map((s) => toView(r, s, context)));
    return views.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
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
  const staffId = newId();
  try {
    await deps.uow.run(actor.tenantId, (r) => assertEmailsFree(r, { email, altEmail }, null));
    const resolved = input.homeAddress ? await resolveStaffHome(deps.maps, input.homeAddress) : null;
    const passwordHash = input.initialPassword ? await deps.passwordHasher.hash(input.initialPassword) : null;
    const patch = profilePatch(input);
    const staff = await deps.uow.run(
      actor.tenantId,
      async (r) => {
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
        if (input.scheduleCalendarId) {
          await r.staffCalendars.setScheduleCalendar(staffId, input.scheduleCalendarId, newId());
        }
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

/** 自宅住所が変わるなら、トランザクションの前にジオコーディングしておく(変わらなければ null)。 */
async function resolveChangedHome(
  deps: StaffAdminDeps,
  tenantId: string,
  staffId: string,
  homeAddress: string | null | undefined,
): Promise<ResolvedStaffHome | null> {
  if (homeAddress === undefined) return null;
  const current = await deps.uow.run(tenantId, (r) => r.staff.findById(staffId));
  if (!current) throw notFound('スタッフが見つかりません', 'not_found');
  const next = homeAddress?.trim() || null;
  return next === current.homeAddress ? null : resolveStaffHome(deps.maps, next);
}

/**
 * 管理者によるスタッフ情報の更新。自分自身の管理者権限の解除・退職日の設定は、管理者が誰もいなくなる事故を
 * 防ぐため拒否する。退職日を設定したらそのスタッフのセッションを失効させる。自宅住所を変えたら緯度経度も
 * 置き換える(ジオコーディングできなければ空にし、ルート計算は住所で行う)。
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
    const resolved = await resolveChangedHome(deps, actor.tenantId, staffId, input.homeAddress);
    const staff = await deps.uow.run(
      actor.tenantId,
      async (r) => {
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
        const updated = await r.staff.update(staffId, patch, input.rowVersion);
        if (!updated) throw notFound('スタッフが見つかりません', 'not_found');
        if (input.scheduleCalendarId !== undefined) {
          const calendars = await r.staffCalendars.listAll();
          const currentCalendar =
            calendars.find((c) => c.staffId === staffId && c.purpose === 'schedule')?.calendarId ?? null;
          if (currentCalendar !== input.scheduleCalendarId) {
            await r.staffCalendars.setScheduleCalendar(staffId, input.scheduleCalendarId, newId());
          }
        }
        if (patch.retiredOn) await r.sessions.revokeAllForStaff(staffId, currentTime(deps));
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
 * 管理者によるスタッフの削除。間違えて登録したスタッフを消すためのもので、業務の記録(出勤簿・報告・領収書等)が
 * 1件でもあれば消さずに conflict にする(記録を残したまま使えなくするのは退職日)。自分自身は削除できない。
 */
export async function deleteStaffByAdmin(deps: StaffAdminDeps, actor: Actor, staffId: string): Promise<void> {
  try {
    if (staffId === actor.staffId) {
      throw invalid('自分自身は削除できません', undefined, 'cannot_delete_self');
    }
    await deps.uow.run(
      actor.tenantId,
      async (r) => {
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
 * 本人の「パスワードを忘れたとき」と同じコード・同じ outbox の送信を使い、回数の上限もアカウント単位で共有する
 * (案内を送り続けてもメールが溢れないように)。送り先はメールアドレス(主)。
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
    const limit = await deps.rateLimiter.consume(
      deps.rateLimits.passwordResetRequestAccount,
      accountRateLimitKey(tenantSlug, staff.email),
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
