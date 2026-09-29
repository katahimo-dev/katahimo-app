import { isSameStaffName, isStaffCalendarAllowed, type TenantCalendarSettings } from '@katahimo/core/domain';
import type { ScheduleStaff } from '@katahimo/core/ports';

/** 予定を読むカレンダー1つ。ownerName が無ければカレンダーの名前(summary)を持ち主名として使う。 */
export interface CalendarSource {
  calendarId: string;
  ownerName?: string;
  /** ログ用: スタッフの予定のカレンダー(staff_calendars)由来ならそのスタッフのID。 */
  staffId?: string;
}

export interface ResolvedCalendarSources {
  sources: CalendarSource[];
  /** 予定のカレンダーが許可の一覧に合わず、読まなかったスタッフ(許可を後から外した場合等)。 */
  disallowedStaffIds: string[];
}

/**
 * テナントで読むカレンダー一覧。GAS版は実行アカウントが購読している全カレンダー
 * (CalendarApp.getAllCalendars())を読み、カレンダー名をスタッフ名として扱っていた。
 * 新アプリでは次の2つを合わせたものを読む(同じカレンダーIDは1回だけ、スタッフ設定を優先):
 * 1. スタッフの予定のカレンダー(staff_calendars の purpose = 'schedule'。持ち主=そのスタッフ)のうち、テナントの
 *    許可の一覧(calendar_settings.allowedStaffCalendars)に合うもの。読むときにも確かめ直す(許可を外したら読まない)
 * 2. テナントの共有カレンダー(calendar_settings.sharedCalendars。持ち主名の指定が無ければカレンダー名)
 * 同じ予定が複数のカレンダーに載っている場合は、この順で先に読んだ方の持ち主になる。
 */
export function resolveCalendarSources(
  settings: TenantCalendarSettings,
  staff: ScheduleStaff[],
): ResolvedCalendarSources {
  const sources = new Map<string, CalendarSource>();
  const disallowedStaffIds: string[] = [];
  for (const member of staff) {
    const calendarId = member.calendarId?.trim().toLowerCase();
    if (!calendarId || sources.has(calendarId)) continue;
    if (!isStaffCalendarAllowed(settings, calendarId)) {
      disallowedStaffIds.push(member.id);
      continue;
    }
    sources.set(calendarId, { calendarId, ownerName: member.name, staffId: member.id });
  }
  for (const source of settings.sharedCalendars) {
    if (!sources.has(source.calendarId)) sources.set(source.calendarId, { ...source });
  }
  return { sources: [...sources.values()], disallowedStaffIds };
}

/**
 * 閲覧(予定タブの view / 🔄 refresh)で読むカレンダーを、対象スタッフの予定が載りうるものに絞る。
 * resolveCalendarSources の結果(持ち主の割り当て・許可の一覧の確認はそのまま)から次だけを残す:
 * 1. 対象スタッフ自身の予定のカレンダー(同じカレンダーを複数のスタッフが設定していて、全体では先のスタッフが
 *    持ち主になっている場合も読む。持ち主は全体と同じにして、担当者の判定が strict / fresh とずれないようにする)
 * 2. 持ち主名(ownerName)が対象スタッフ名と一致するカレンダー(共有カレンダー・同姓同名のスタッフのカレンダー)
 * 3. 持ち主名の指定が無い共有カレンダー(持ち主がカレンダー名でしか分からず、読むまで判断できないため)
 * 持ち主名が他のスタッフ名のカレンダーは読まない。運用上、RESERVA で担当を変えると予定は新しい担当者の
 * カレンダーへ移るため、[予約確定] の「施設：<名前>」は通常その人のカレンダーにある。
 * 取りこぼす例外(他スタッフのカレンダーに手作業で作った「施設：<対象>」の予定、対象がゲストだが対象の
 * カレンダーに無い会議)は予定タブには出ないが、出勤簿には全カレンダーを読む夜間の同期(fresh)で入る。
 * 担当者の判定(classifyCalendarEvents)と対象スタッフ分の選び出しは変えない。
 */
export function selectViewCalendarSources(
  sources: CalendarSource[],
  target: Pick<ScheduleStaff, 'id' | 'name' | 'calendarId'>,
): CalendarSource[] {
  const ownCalendarId = target.calendarId?.trim().toLowerCase();
  return sources.filter((source) => {
    if (source.staffId === target.id) return true;
    if (ownCalendarId && source.calendarId === ownCalendarId) return true;
    if (source.ownerName === undefined) return source.staffId === undefined;
    return isSameStaffName(source.ownerName, target.name);
  });
}
