import { normalizeStaffName } from '../staffName';
import { sortByStart } from './staffAppointments';
import type { Appointment } from './types';

/**
 * 同じスタッフの時間が重なる[事務]予定を1件にまとめる。
 *
 * 移植元: RouteSearch.js mergeOverlappingOfficeWork。
 * - スタッフ名は空白差異を無視して同一視する。
 * - 開始時刻順に並べ、直前のまとまりの終了時刻より「前に」始まる予定を同じまとまりに入れる
 *   (ちょうど終了時刻に始まる予定は別扱い)。終了時刻は最も遅いものに伸ばす。
 * - 名前は「,」区切りで連結し、場所はまとまりの最初の予定のものを使う。
 * - 戻り値は「事務以外(元の順)」→「まとめた事務(スタッフの初出順・開始時刻順)」の順。
 *   同時刻の予定の表示順がこの順に依存するため、並べ方もGAS版と揃えている。
 */
export function mergeOverlappingOfficeWork(appointments: Appointment[]): Appointment[] {
  const others = appointments.filter((a) => a.type !== 'OFFICE WORK');
  const byStaff = new Map<string, Appointment[]>();
  for (const appointment of appointments) {
    if (appointment.type !== 'OFFICE WORK') continue;
    const key = normalizeStaffName(appointment.assigneeNames[0]);
    const group = byStaff.get(key);
    if (group) group.push(appointment);
    else byStaff.set(key, [appointment]);
  }
  if (byStaff.size === 0) return appointments;

  const merged = [...byStaff.values()].flatMap((group) => {
    const assigneeNames = group[0]?.assigneeNames ?? [];
    return mergeSortedGroup(sortByStart(group)).map((m) => ({ ...m, assigneeNames }));
  });
  return [...others, ...merged];
}

function mergeSortedGroup(sorted: Appointment[]): Appointment[] {
  const result: Appointment[] = [];
  let current: { base: Appointment; names: string[]; end: Date } | null = null;
  for (const appointment of sorted) {
    if (current && appointment.start < current.end) {
      current.names.push(appointment.name);
      if (appointment.end > current.end) current.end = appointment.end;
      continue;
    }
    if (current) result.push(toMerged(current));
    current = { base: appointment, names: [appointment.name], end: appointment.end };
  }
  if (current) result.push(toMerged(current));
  return result;
}

function toMerged({ base, names, end }: { base: Appointment; names: string[]; end: Date }): Appointment {
  return { ...base, name: names.join(','), end };
}
