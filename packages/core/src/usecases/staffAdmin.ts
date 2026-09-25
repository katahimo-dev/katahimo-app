import {
  conflict,
  invalid,
  isRetiredOn,
  normalizeEmailForIndex,
  notFound,
  splitJapaneseFullName,
  zonedBusinessDate,
} from '../domain';
import type { StaffRole } from '../domain/model';
import type { AppLogPort } from '../ports/appLog';
import type { StaffPatch, StaffRecord } from '../ports/staff';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth';
import { registerStaff } from './auth';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface StaffAdminDeps extends Clock {
  uow: UnitOfWorkPort;
  passwordHasher: PasswordHasherPort;
  appLog: AppLogPort;
}

export interface AdminStaffView {
  id: string;
  name: string;
  email: string;
  altEmail: string | null;
  phone: string | null;
  role: StaffRole;
  retiredOn: string | null;
  isRetired: boolean;
  passwordStatus: 'set' | 'legacy' | 'unset';
}

async function toView(r: TenantRepositories, staff: StaffRecord, today: string): Promise<AdminStaffView> {
  const credentials = await r.staff.getCredentials(staff.id);
  return {
    id: staff.id,
    name: staff.displayName,
    email: staff.email,
    altEmail: staff.altEmail,
    phone: staff.phone,
    role: staff.role,
    retiredOn: staff.retiredOn,
    isRetired: isRetiredOn(staff.retiredOn, today),
    passwordStatus: credentials?.passwordHash ? 'set' : credentials?.legacyPasswordHash ? 'legacy' : 'unset',
  };
}

async function todayOf(deps: StaffAdminDeps, r: TenantRepositories): Promise<string> {
  return zonedBusinessDate(currentTime(deps), (await r.tenant()).timezone);
}

/** 管理者向けスタッフ一覧(退職者を含む、氏名順)。GAS版スタッフ台帳シートの閲覧に相当。 */
export function listStaffForAdmin(deps: StaffAdminDeps, tenantId: string): Promise<AdminStaffView[]> {
  return deps.uow.run(tenantId, async (r) => {
    const today = await todayOf(deps, r);
    const views = await Promise.all((await r.staff.listAll()).map((s) => toView(r, s, today)));
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

export interface CreateStaffInput {
  name: string;
  email: string;
  altEmail?: string | null;
  phone?: string | null;
  role: StaffRole;
  /** 省略時はパスワード未設定(本人がパスワード再設定で初回設定する)。 */
  initialPassword?: string;
}

async function logRejected(
  deps: StaffAdminDeps,
  actor: Actor,
  action: string,
  reason: string,
  targetStaffId: string | null,
) {
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'WARN',
    action,
    actorStaffId: actor.staffId,
    targetStaffId,
    details: { reason },
    ...actor.meta,
  });
}

/** 管理者によるスタッフの新規登録。 */
export async function createStaffByAdmin(
  deps: StaffAdminDeps,
  actor: Actor,
  input: CreateStaffInput,
): Promise<AdminStaffView> {
  const email = normalizeEmailForIndex(input.email);
  const altEmail = input.altEmail ? normalizeEmailForIndex(input.altEmail) : null;
  try {
    await deps.uow.run(actor.tenantId, (r) => assertEmailsFree(r, { email, altEmail }, null));
  } catch (error) {
    await logRejected(deps, actor, 'staff.admin.create_rejected', 'email_conflict', null);
    throw error;
  }
  const created = await registerStaff(deps, {
    tenantId: actor.tenantId,
    name: input.name,
    email,
    altEmail,
    phone: input.phone ?? null,
    role: input.role,
    ...(input.initialPassword ? { password: input.initialPassword } : {}),
  });
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'SECURITY',
    action: 'staff.admin.created',
    actorStaffId: actor.staffId,
    targetStaffId: created.id,
    details: { role: created.role, initialPasswordSet: Boolean(input.initialPassword) },
    ...actor.meta,
  });
  return deps.uow.run(actor.tenantId, async (r) => toView(r, created, await todayOf(deps, r)));
}

export interface UpdateStaffInput {
  name?: string;
  email?: string;
  altEmail?: string | null;
  phone?: string | null;
  role?: StaffRole;
  retiredOn?: string | null;
}

/**
 * 管理者によるスタッフ情報の更新。自分自身の管理者権限の解除・退職日の設定は、管理者が誰もいなくなる事故を
 * 防ぐため拒否する。
 */
export async function updateStaffByAdmin(
  deps: StaffAdminDeps,
  actor: Actor,
  staffId: string,
  input: UpdateStaffInput,
): Promise<AdminStaffView> {
  try {
    const { view, changedFields } = await deps.uow.run(actor.tenantId, async (r) => {
      const current = await r.staff.findById(staffId);
      if (!current) throw notFound('スタッフが見つかりません', 'not_found');
      if (staffId === actor.staffId && input.role !== undefined && input.role !== 'admin') {
        throw invalid('自分自身の管理者権限は解除できません', undefined, 'cannot_demote_self');
      }
      if (staffId === actor.staffId && input.retiredOn) {
        throw invalid('自分自身に退職日は設定できません', undefined, 'cannot_retire_self');
      }
      const patch: StaffPatch = {};
      if (input.name !== undefined) {
        const name = input.name.trim();
        const split = splitJapaneseFullName(name);
        Object.assign(patch, { displayName: name, familyName: split.familyName, givenName: split.givenName });
      }
      if (input.email !== undefined) patch.email = normalizeEmailForIndex(input.email);
      if (input.altEmail !== undefined)
        patch.altEmail = input.altEmail ? normalizeEmailForIndex(input.altEmail) : null;
      if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
      if (input.role !== undefined) patch.role = input.role;
      if (input.retiredOn !== undefined) patch.retiredOn = input.retiredOn;
      await assertEmailsFree(
        r,
        {
          email: patch.email ?? current.email,
          altEmail: patch.altEmail !== undefined ? patch.altEmail : current.altEmail,
        },
        staffId,
      );
      const updated = await r.staff.update(staffId, patch);
      if (!updated) throw notFound('スタッフが見つかりません', 'not_found');
      if (patch.retiredOn) await r.sessions.revokeAllForStaff(staffId, currentTime(deps));
      return { view: await toView(r, updated, await todayOf(deps, r)), changedFields: Object.keys(input) };
    });
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'staff.admin.updated',
      actorStaffId: actor.staffId,
      targetStaffId: staffId,
      details: {
        changedFields,
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.retiredOn !== undefined ? { retiredOn: input.retiredOn } : {}),
      },
      ...actor.meta,
    });
    return view;
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    if (reason)
      await logRejected(
        deps,
        actor,
        'staff.admin.update_rejected',
        reason,
        reason === 'not_found' ? null : staffId,
      );
    throw error;
  }
}
