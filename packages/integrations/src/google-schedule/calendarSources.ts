import { isStaffCalendarAllowed, type TenantCalendarSettings } from '@katahimo/core/domain';
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
