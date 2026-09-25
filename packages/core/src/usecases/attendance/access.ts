import { canActForOthers, forbidden, notFound } from '../../domain';
import type { AppLogEntry, AppLogPort } from '../../ports/appLog';
import type { TenantRepositories } from '../../ports/unitOfWork';
import type { Actor } from '../requestMeta';

/** 操作対象のスタッフ。 */
export interface AttendanceTarget {
  staffId: string;
  staffName: string;
  /** 他のスタッフのデータを扱っている(操作ログの記録対象)。 */
  isOtherStaff: boolean;
}

/**
 * 対象スタッフを読み、扱ってよいかを確かめる(UoW の中で呼ぶ)。対象の決定(一般スタッフは常に本人)は API の
 * resolveTargetStaffId が行うが、usecase でも同じ規則を確かめ、存在しない・他テナントのスタッフを弾く。
 */
export async function loadAttendanceTarget(
  r: TenantRepositories,
  actor: Actor,
  targetStaffId: string,
): Promise<AttendanceTarget> {
  if (!canActForOthers(actor.role) && targetStaffId !== actor.staffId) {
    throw forbidden('他のスタッフの出勤簿は操作できません。');
  }
  const staff = await r.staff.findById(targetStaffId);
  if (!staff) throw notFound('対象のスタッフが見つかりません。');
  return { staffId: staff.id, staffName: staff.displayName, isOtherStaff: staff.id !== actor.staffId };
}

type ActorLogEntry = Omit<AppLogEntry, 'tenantId' | 'actorStaffId' | 'targetStaffId'>;

/** 操作者・対象スタッフを付けて操作ログを書く。 */
export function writeActorLog(
  appLog: AppLogPort,
  actor: Actor,
  target: { staffId: string } | null,
  entry: ActorLogEntry,
): Promise<void> {
  return appLog.write({
    ...entry,
    tenantId: actor.tenantId,
    actorStaffId: actor.staffId,
    targetStaffId: target?.staffId ?? null,
    ...actor.meta,
  });
}

/** 閲覧の成功ログ。GAS版の方針どおり、他スタッフのデータを見た場合だけ記録する。 */
export async function logCrossStaffRead(
  appLog: AppLogPort,
  actor: Actor,
  target: AttendanceTarget,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (!target.isOtherStaff) return;
  await writeActorLog(appLog, actor, target, { level: 'INFO', action, details });
}
