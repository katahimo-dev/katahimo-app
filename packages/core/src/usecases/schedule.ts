import type { StaffRepositoryPort } from '../ports/repositories';
import type { ScheduleLightResult, SchedulePort, ScheduleWithRouteResult } from '../ports/schedule';

export interface ScheduleDeps {
  schedule: SchedulePort;
  staff: StaffRepositoryPort;
}

/**
 * GAS版RouteSearch.jsの各関数はスタッフを名前(文字列)で突き合わせるため、katahimo-app内部の
 * staffId(UUID)から氏名へ変換してから橋渡しする。
 */
async function resolveStaffName(deps: ScheduleDeps, tenantId: string, staffId: string): Promise<string> {
  const staffRecord = await deps.staff.findById(tenantId, staffId);
  if (!staffRecord) throw new Error('スタッフが見つかりません');
  return staffRecord.name;
}

/** GAS版Schedule.js getScheduleForDateに対応(ルート・移動時間を含まない軽量版)。 */
export async function getScheduleForStaff(
  deps: ScheduleDeps,
  tenantId: string,
  staffId: string,
  dateString: string,
): Promise<ScheduleLightResult> {
  const staffName = await resolveStaffName(deps, tenantId, staffId);
  return deps.schedule.getSchedule(staffName, dateString);
}

/** GAS版Schedule.js getRouteForStaffOnDateに対応(ルート・移動時間つき)。 */
export async function getScheduleWithRouteForStaff(
  deps: ScheduleDeps,
  tenantId: string,
  staffId: string,
  dateString: string,
  forceRefresh: boolean,
): Promise<ScheduleWithRouteResult> {
  const staffName = await resolveStaffName(deps, tenantId, staffId);
  return deps.schedule.getScheduleWithRoute(staffName, dateString, forceRefresh);
}
