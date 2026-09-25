import type { AttendanceDeps } from './deps';

/** usecase が「今」とみなす時刻(テストでは deps.now で固定する)。 */
export function currentTime(deps: Pick<AttendanceDeps, 'now'>): Date {
  return deps.now ? deps.now() : new Date();
}
