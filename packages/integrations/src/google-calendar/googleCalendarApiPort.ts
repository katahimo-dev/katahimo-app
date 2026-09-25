import type { CalendarEvent } from '@katahimo/core/domain';
import { jstMidnight } from '@katahimo/core/domain';
import type {
  CalendarBusyResult,
  CalendarEventList,
  GoogleCalendarPort,
  InstantRange,
} from '@katahimo/core/ports';
import type { calendar_v3 } from 'googleapis';

/**
 * Google Calendar API v3 のうちこのアダプターが使う呼び出しだけを切り出したもの
 * (テストではAPIレスポンスのJSONを返すフェイクに差し替える)。実装は createCalendarApiClient。
 */
export interface CalendarApiClient {
  listEvents(params: calendar_v3.Params$Resource$Events$List): Promise<calendar_v3.Schema$Events>;
  queryFreeBusy(body: calendar_v3.Schema$FreeBusyRequest): Promise<calendar_v3.Schema$FreeBusyResponse>;
}

/**
 * GoogleCalendarPort の実装(サービスアカウントで読み取り専用)。
 *
 * GAS版 CalendarApp.getCalendarById(id).getEvents(start, end) 相当の読み方をする:
 * 繰り返し予定は1件ずつに展開し(singleEvents)、範囲に一部でも重なる予定を返す。
 * 終日予定は start.date/end.date(日付のみ)で返るため、JSTの0:00として扱う
 * (GAS版はスクリプトのタイムゾーン=Asia/Tokyoの0:00を返していた)。
 */
export class GoogleCalendarApiPort implements GoogleCalendarPort {
  constructor(private readonly client: CalendarApiClient) {}

  async listEvents(calendarId: string, range: InstantRange): Promise<CalendarEventList> {
    const events: CalendarEvent[] = [];
    let calendarName = '';
    let pageToken: string | undefined;
    do {
      const page = await this.client.listEvents({
        calendarId,
        timeMin: range.from.toISOString(),
        timeMax: range.to.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        ...(pageToken ? { pageToken } : {}),
      });
      calendarName ||= page.summary ?? '';
      for (const item of page.items ?? []) {
        const event = toCalendarEvent(item);
        if (event) events.push(event);
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return { calendarName, events };
  }

  async freeBusy(calendarIds: string[], range: InstantRange): Promise<Map<string, CalendarBusyResult>> {
    const result = new Map<string, CalendarBusyResult>();
    if (calendarIds.length === 0) return result;
    const response = await this.client.queryFreeBusy({
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    });
    for (const id of calendarIds) {
      const calendar = response.calendars?.[id];
      const errors = calendar?.errors ?? [];
      if (!calendar || errors.length > 0) {
        const reason = errors.map((e) => e.reason).join(', ') || 'notFound';
        result.set(id, { busy: [], error: `free/busyを取得できません: ${reason}` });
        continue;
      }
      result.set(id, {
        busy: (calendar.busy ?? [])
          .filter((p): p is { start: string; end: string } => !!p.start && !!p.end)
          .map((p) => ({ start: new Date(p.start), end: new Date(p.end) })),
      });
    }
    return result;
  }
}

function toCalendarEvent(item: calendar_v3.Schema$Event): CalendarEvent | null {
  if (item.status === 'cancelled') return null;
  const start = toInstant(item.start);
  const end = toInstant(item.end);
  if (!start || !end) return null;

  const attendees = item.attendees ?? [];
  return {
    dedupeKey: item.iCalUID ?? item.id ?? '',
    title: item.summary ?? '',
    description: item.description ?? '',
    location: item.location ?? '',
    start,
    end,
    allDay: !item.start?.dateTime,
    // GAS版 getGuestList() は主催者を含まない。表示名が無ければメールアドレス(getName() || getEmail())。
    guestNames: attendees.filter((a) => !a.organizer).map((a) => a.displayName || a.email || ''),
    // attendees[].self は「このカレンダー自身」の出欠(GAS版 getMyStatus() に相当)。
    declinedByOwner: attendees.some((a) => a.self && a.responseStatus === 'declined'),
  };
}

function toInstant(time: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (time?.dateTime) return new Date(time.dateTime);
  if (time?.date) return jstMidnight(time.date);
  return null;
}
