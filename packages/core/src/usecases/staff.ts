import { canActForOthers, zonedBusinessDate } from '../domain';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface ActiveStaffView {
  id: string;
  name: string;
}

/**
 * 「対象スタッフ」の選択肢(退職者を除く)。GAS版 PastSchedule.js getActiveStaffNamesForAdmin。他のスタッフを
 * 扱えないロール(一般スタッフ)には空の一覧を返す(GAS版と同じ)。並びは GAS版の names.sort() と同じ単純な比較。
 */
export function listActiveStaffForActor(
  deps: { uow: UnitOfWorkPort } & Clock,
  actor: Actor,
): Promise<ActiveStaffView[]> {
  if (!canActForOthers(actor.role)) return Promise.resolve([]);
  return deps.uow.run(actor.tenantId, async (r) => {
    const today = zonedBusinessDate(currentTime(deps), (await r.tenant()).timezone);
    return (await r.staff.listActiveOn(today))
      .map((s) => ({ id: s.id, name: s.displayName }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  });
}
