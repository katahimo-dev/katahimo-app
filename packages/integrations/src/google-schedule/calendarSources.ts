import type { ScheduleStaff } from '@katahimo/core/ports';

/** 予定を読むカレンダー1つ。ownerName が無ければカレンダーの名前(summary)を持ち主名として使う。 */
export interface CalendarSource {
  calendarId: string;
  ownerName?: string;
  /** ログ用: staff.calendar_id 由来ならそのスタッフのID。 */
  staffId?: string;
}

/**
 * 環境変数 GOOGLE_CALENDAR_IDS を解析する。書式はカンマ区切りで、各要素は
 * `カレンダーID` または `カレンダーID=持ち主のスタッフ名`。
 * 例: `abc@group.calendar.google.com,yamada@example.com=山田 花子`
 */
export function parseCalendarSourcesEnv(value: string | undefined): CalendarSource[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf('=');
      if (separator < 0) return { calendarId: entry };
      const calendarId = entry.slice(0, separator).trim();
      const ownerName = entry.slice(separator + 1).trim();
      return ownerName ? { calendarId, ownerName } : { calendarId };
    })
    .filter((source) => source.calendarId !== '');
}

/**
 * テナントで読むカレンダー一覧。GAS版は実行アカウントが購読している全カレンダー
 * (CalendarApp.getAllCalendars())を読み、カレンダー名をスタッフ名として扱っていた。
 * 新アプリでは次の2つを合わせたものを読む(同じカレンダーIDは1回だけ、スタッフ設定を優先):
 * 1. staff.calendar_id が設定されたスタッフのカレンダー(持ち主=そのスタッフ)
 * 2. 環境変数 GOOGLE_CALENDAR_IDS(共有カレンダー等。持ち主名の指定が無ければカレンダー名)
 * 同じ予定が複数のカレンダーに載っている場合は、この順で先に読んだ方の持ち主になる。
 */
export function resolveCalendarSources(
  configured: CalendarSource[],
  staff: ScheduleStaff[],
): CalendarSource[] {
  const sources = new Map<string, CalendarSource>();
  for (const member of staff) {
    const calendarId = member.calendarId?.trim();
    if (calendarId && !sources.has(calendarId)) {
      sources.set(calendarId, { calendarId, ownerName: member.name, staffId: member.id });
    }
  }
  for (const source of configured) {
    if (!sources.has(source.calendarId)) sources.set(source.calendarId, source);
  }
  return [...sources.values()];
}
