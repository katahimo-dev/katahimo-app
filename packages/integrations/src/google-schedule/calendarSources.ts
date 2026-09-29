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

/**
 * 閲覧(予定タブの view / 🔄 refresh)で読むカレンダーを絞る。resolveCalendarSources の結果(持ち主の割り当て・
 * 許可の一覧の確認はそのまま)から、他のスタッフの予定のカレンダー(staff_calendars 由来)だけを除く:
 * 1. 対象スタッフ自身の予定のカレンダーは読む(同じカレンダーを複数のスタッフが設定していて、全体では先のスタッフが
 *    持ち主になっている場合も読む。持ち主は全体と同じにして、担当者の判定が strict / fresh とずれないようにする)
 * 2. 共有カレンダー(sharedCalendars)は持ち主名(ownerName)にかかわらず全部読む。RESERVA の予約カレンダーに
 *    持ち主名を付けても([予約確定] の担当は説明欄の「施設：」で決まるため)他のスタッフの予定が消えないようにする。
 *    共有カレンダーは数が少ない前提で、読み込みを減らす主な効果は他のスタッフのカレンダーを読まないこと。
 * 3. 他のスタッフの予定のカレンダーは読まない(同姓同名のスタッフのカレンダーも読まない)。運用上、RESERVA で担当を
 *    変えると予定は新しい担当者のカレンダーへ移るため、[予約確定] の「施設：<名前>」は通常その人のカレンダーにある。
 * 取りこぼす例外(他スタッフのカレンダーに手作業で作った「施設：<対象>」の予定、対象がゲストだが対象の
 * カレンダーに無い会議、同姓同名の他スタッフのカレンダーの予定)は予定タブには出ないが、出勤簿には全カレンダーを
 * 読む夜間の同期(fresh)で入る。また同じ予定(iCalUID)が他のスタッフのカレンダーにもあると、全体では先に読んだ
 * そのスタッフが持ち主になるが、閲覧では読んだ中で先のカレンダー(対象スタッフ自身等)が持ち主になるため、
 * [新規]・[事務]・ゲストのいない [イベント] は予定タブにだけ出ることがある。
 * 担当者の判定の規則(classifyCalendarEvents)と対象スタッフ分の選び出しは変えない。
 */
export function selectViewCalendarSources(
  sources: CalendarSource[],
  target: Pick<ScheduleStaff, 'id' | 'calendarId'>,
): CalendarSource[] {
  const ownCalendarId = target.calendarId?.trim().toLowerCase();
  return sources.filter(
    (source) =>
      source.staffId === undefined ||
      source.staffId === target.id ||
      (ownCalendarId !== undefined && ownCalendarId !== '' && source.calendarId === ownCalendarId),
  );
}
