import type { AppLogEntry } from '../../ports/appLog';
import type { AttendanceDeps } from './deps';
import { AttendanceError } from './errors';

/** 操作しているログインユーザー(セッションから解決済みのもの)。 */
export interface AttendanceActor {
  tenantId: string;
  staffId: string;
  isAdmin: boolean;
}

/** 操作対象のスタッフ。 */
export interface AttendanceTarget {
  staffId: string;
  staffName: string;
  /** 管理者が他スタッフのデータを扱っている(操作ログの記録対象)。 */
  isOtherStaff: boolean;
}

/**
 * 対象スタッフを読み込み、アクセスしてよいかを確かめる。
 *
 * 対象staffIdの決定(一般スタッフは常に本人、管理者だけが指定可)はAPI層の
 * resolveAttendanceTargetStaffId が行う(GAS版 resolvePastScheduleTargetStaffName_)。
 * ここでは念のため同じ規則を再確認し、存在しない/他テナントのスタッフを弾く。
 */
export async function loadAttendanceTarget(
  deps: Pick<AttendanceDeps, 'staff'>,
  actor: AttendanceActor,
  targetStaffId: string,
): Promise<AttendanceTarget> {
  if (!actor.isAdmin && targetStaffId !== actor.staffId) {
    throw new AttendanceError('forbidden', '他のスタッフの出勤簿は操作できません。');
  }
  const staff = await deps.staff.findById(actor.tenantId, targetStaffId);
  if (!staff) throw new AttendanceError('staff_not_found', '対象のスタッフが見つかりません。');
  return { staffId: staff.id, staffName: staff.name, isOtherStaff: staff.id !== actor.staffId };
}

type ActorLogEntry = Omit<AppLogEntry, 'tenantId' | 'actorStaffId' | 'targetStaffId'>;

/** 操作者・対象スタッフを付けて操作ログを書く。 */
export function writeActorLog(
  deps: Pick<AttendanceDeps, 'appLog'>,
  actor: AttendanceActor,
  target: AttendanceTarget | null,
  entry: ActorLogEntry,
): Promise<void> {
  return deps.appLog.write({
    ...entry,
    tenantId: actor.tenantId,
    actorStaffId: actor.staffId,
    targetStaffId: target?.staffId ?? null,
  });
}

/**
 * 閲覧系の成功ログ。GAS版の方針どおり、管理者が他スタッフのデータを見た場合だけ記録する
 * (本人の閲覧は高頻度のため記録しない)。
 */
export async function logCrossStaffRead(
  deps: Pick<AttendanceDeps, 'appLog'>,
  actor: AttendanceActor,
  target: AttendanceTarget,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (!target.isOtherStaff) return;
  await writeActorLog(deps, actor, target, { level: 'INFO', action, details });
}
