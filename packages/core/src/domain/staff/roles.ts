import type { StaffRole } from '@katahimo/shared';
import { canActForOthers } from '@katahimo/shared';

// 役割の判定はブラウザと共通(@katahimo/shared)
export { canActForOthers, isAdminRole } from '@katahimo/shared';

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
