import { isRetiredOn, jstBusinessDate, normalizeEmailForIndex } from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { StaffPatch, StaffRecord, StaffRepositoryPort } from '../ports/repositories';
import type { PasswordHasherPort } from './auth';
import { registerStaff } from './auth';
import type { RequestMeta } from './requestMeta';

export interface StaffAdminDeps {
  staff: StaffRepositoryPort;
  passwordHasher: PasswordHasherPort;
  appLog: AppLogPort;
  now?: () => Date;
}

/** スタッフ管理を行う管理者(権限確認はAPIルート側で済ませてから呼ぶ)。 */
export interface StaffAdminActor {
  tenantId: string;
  staffId: string;
  meta?: RequestMeta;
}

export interface AdminStaffView {
  id: string;
  name: string;
  email: string;
  altEmail: string | null;
  phone: string | null;
  isAdmin: boolean;
  retirementDate: string | null;
  isRetired: boolean;
  passwordStatus: 'set' | 'legacy' | 'unset';
}

export function toAdminStaffView(staff: StaffRecord, today: string): AdminStaffView {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    altEmail: staff.altEmail,
    phone: staff.phone,
    isAdmin: staff.isAdmin,
    retirementDate: staff.retirementDate,
    isRetired: isRetiredOn(staff.retirementDate, today),
    passwordStatus: staff.passwordHash ? 'set' : staff.legacyPasswordHash ? 'legacy' : 'unset',
  };
}

function today(deps: StaffAdminDeps): string {
  return jstBusinessDate(deps.now ? deps.now() : new Date());
}

/** 管理者向けスタッフ一覧(退職者を含む、氏名順)。GAS版スタッフ台帳シートの閲覧に相当。 */
export async function listStaffForAdmin(deps: StaffAdminDeps, tenantId: string): Promise<AdminStaffView[]> {
  const date = today(deps);
  return (await deps.staff.listAll(tenantId))
    .map((s) => toAdminStaffView(s, date))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export type EmailField = 'email' | 'altEmail';

/**
 * email/altEmailがテナント内で他スタッフと重複していないか確認する。
 * UNIQUE制約は列ごとにしか張れず「Aのemail = Bのalt_email」を防げないため、両列をまとめて調べる
 * (findByLoginEmailはemail・alt_emailのどちらかに一致する行を返す)。
 */
async function findEmailConflict(
  deps: StaffAdminDeps,
  tenantId: string,
  emails: Partial<Record<EmailField, string | null>>,
  selfId: string | null,
): Promise<EmailField | null> {
  if (emails.email && emails.altEmail && emails.email === emails.altEmail) return 'altEmail';
  for (const field of ['email', 'altEmail'] as const) {
    const value = emails[field];
    if (!value) continue;
    const owner = await deps.staff.findByLoginEmail(tenantId, value);
    if (owner && owner.id !== selfId) return field;
  }
  return null;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  altEmail?: string | null;
  phone?: string | null;
  isAdmin: boolean;
  /** 省略時はパスワード未設定(本人がパスワード再設定で初回設定する)。 */
  initialPassword?: string;
}

export type StaffAdminResult =
  | { ok: true; staff: AdminStaffView }
  | { ok: false; reason: 'email_conflict'; field: EmailField }
  | { ok: false; reason: 'not_found' | 'cannot_demote_self' | 'cannot_retire_self' };

/** 管理者によるスタッフの新規登録。 */
export async function createStaffByAdmin(
  deps: StaffAdminDeps,
  actor: StaffAdminActor,
  input: CreateStaffInput,
): Promise<StaffAdminResult> {
  const email = normalizeEmailForIndex(input.email);
  const altEmail = input.altEmail ? normalizeEmailForIndex(input.altEmail) : null;
  const conflict = await findEmailConflict(deps, actor.tenantId, { email, altEmail }, null);
  if (conflict) {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'WARN',
      action: 'staff.admin.create_rejected',
      actorStaffId: actor.staffId,
      details: { reason: 'email_conflict', field: conflict },
      ...actor.meta,
    });
    return { ok: false, reason: 'email_conflict', field: conflict };
  }

  const created = await registerStaff(deps, {
    tenantId: actor.tenantId,
    name: input.name,
    email,
    altEmail,
    phone: input.phone,
    password: input.initialPassword,
    isAdmin: input.isAdmin,
  });
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'SECURITY',
    action: 'staff.admin.created',
    actorStaffId: actor.staffId,
    targetStaffId: created.id,
    details: { isAdmin: created.isAdmin, initialPasswordSet: Boolean(input.initialPassword) },
    ...actor.meta,
  });
  return { ok: true, staff: toAdminStaffView(created, today(deps)) };
}

export type UpdateStaffInput = Omit<StaffPatch, 'legacyPasswordHash'>;

/**
 * 管理者によるスタッフ情報の更新(氏名・メール・サブメール・電話・管理者権限・退職日)。
 * 自分自身の管理者権限の解除・退職日設定は、管理者が誰もいなくなる事故を防ぐため拒否する。
 */
export async function updateStaffByAdmin(
  deps: StaffAdminDeps,
  actor: StaffAdminActor,
  staffId: string,
  input: UpdateStaffInput,
): Promise<StaffAdminResult> {
  const reject = async (reason: string, extra?: Record<string, unknown>) =>
    deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'WARN',
      action: 'staff.admin.update_rejected',
      actorStaffId: actor.staffId,
      targetStaffId: reason === 'not_found' ? null : staffId,
      details: { reason, ...extra },
      ...actor.meta,
    });

  const current = await deps.staff.findById(actor.tenantId, staffId);
  if (!current) {
    await reject('not_found');
    return { ok: false, reason: 'not_found' };
  }
  if (staffId === actor.staffId && input.isAdmin === false) {
    await reject('cannot_demote_self');
    return { ok: false, reason: 'cannot_demote_self' };
  }
  if (staffId === actor.staffId && input.retirementDate) {
    await reject('cannot_retire_self');
    return { ok: false, reason: 'cannot_retire_self' };
  }

  const patch: StaffPatch = { ...input };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.email !== undefined) patch.email = normalizeEmailForIndex(input.email);
  if (input.altEmail !== undefined)
    patch.altEmail = input.altEmail ? normalizeEmailForIndex(input.altEmail) : null;
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;

  const conflict = await findEmailConflict(
    deps,
    actor.tenantId,
    {
      email: patch.email ?? current.email,
      altEmail: patch.altEmail !== undefined ? patch.altEmail : current.altEmail,
    },
    staffId,
  );
  if (conflict) {
    await reject('email_conflict', { field: conflict });
    return { ok: false, reason: 'email_conflict', field: conflict };
  }

  const updated = await deps.staff.update(actor.tenantId, staffId, patch);
  if (!updated) return { ok: false, reason: 'not_found' };

  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'SECURITY',
    action: 'staff.admin.updated',
    actorStaffId: actor.staffId,
    targetStaffId: staffId,
    details: {
      changedFields: Object.keys(patch),
      ...(patch.isAdmin !== undefined ? { isAdmin: patch.isAdmin } : {}),
      ...(patch.retirementDate !== undefined ? { retirementDate: patch.retirementDate } : {}),
    },
    ...actor.meta,
  });
  return { ok: true, staff: toAdminStaffView(updated, today(deps)) };
}
