import type { calendar_v3 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import type { CalendarApiClient } from './googleCalendarApiPort';
import { GoogleCalendarApiPort } from './googleCalendarApiPort';

const range = { from: new Date('2026-09-24T15:00:00Z'), to: new Date('2026-09-25T15:00:00Z') };

function fakeClient(pages: calendar_v3.Schema$Events[], freeBusy: calendar_v3.Schema$FreeBusyResponse = {}) {
  const listCalls: calendar_v3.Params$Resource$Events$List[] = [];
  const freeBusyCalls: calendar_v3.Schema$FreeBusyRequest[] = [];
  const client: CalendarApiClient = {
    async listEvents(params) {
      listCalls.push(params);
      return pages[listCalls.length - 1] ?? {};
    },
    async queryFreeBusy(body) {
      freeBusyCalls.push(body);
      return freeBusy;
    },
  };
  return { client, listCalls, freeBusyCalls };
}

/** events.list の実際のレスポンスに近い形(RESERVAの予約・招待つきの予定・終日予定)。 */
const reservaEvent: calendar_v3.Schema$Event = {
  kind: 'calendar#event',
  id: 'abc123def456',
  iCalUID: 'reserva-1234567@reserva.be',
  status: 'confirmed',
  summary: '[予約確定]山田 花子',
  description: '予約番号：1234567\n施設：佐藤 美咲[訪問保育]\n予約詳細：https://reserva.be/cutest/r/1234567',
  location: '東京都世田谷区三軒茶屋1-2-3',
  start: { dateTime: '2026-09-25T09:00:00+09:00', timeZone: 'Asia/Tokyo' },
  end: { dateTime: '2026-09-25T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
};

describe('GoogleCalendarApiPort.listEvents', () => {
  it('繰り返しを展開・開始時刻順で範囲を指定して読み、ページをたどってカレンダー名と予定を返す', async () => {
    const { client, listCalls } = fakeClient([
      {
        kind: 'calendar#events',
        summary: '佐藤 美咲',
        timeZone: 'Asia/Tokyo',
        items: [reservaEvent],
        nextPageToken: 'p2',
      },
      {
        kind: 'calendar#events',
        summary: '佐藤 美咲',
        items: [
          {
            id: 'allday1',
            iCalUID: 'allday1@google.com',
            status: 'confirmed',
            summary: '[事務]棚卸し',
            start: { date: '2026-09-25' },
            end: { date: '2026-09-26' },
          },
          { id: 'gone', iCalUID: 'gone@google.com', status: 'cancelled', summary: '[事務]中止' },
        ],
      },
    ]);
    const result = await new GoogleCalendarApiPort(client).listEvents('sato@cutest.biz', range);

    expect(listCalls).toEqual([
      {
        calendarId: 'sato@cutest.biz',
        timeMin: '2026-09-24T15:00:00.000Z',
        timeMax: '2026-09-25T15:00:00.000Z',
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        pageToken: undefined,
      },
      expect.objectContaining({ pageToken: 'p2' }),
    ]);
    expect(result.calendarName).toBe('佐藤 美咲');
    expect(result.events).toEqual([
      {
        dedupeKey: 'reserva-1234567@reserva.be',
        title: '[予約確定]山田 花子',
        description: reservaEvent.description,
        location: '東京都世田谷区三軒茶屋1-2-3',
        start: new Date('2026-09-25T00:00:00Z'),
        end: new Date('2026-09-25T02:00:00Z'),
        allDay: false,
        guestNames: [],
        declinedByOwner: false,
      },
      {
        dedupeKey: 'allday1@google.com',
        title: '[事務]棚卸し',
        description: '',
        location: '',
        start: new Date('2026-09-24T15:00:00Z'),
        end: new Date('2026-09-25T15:00:00Z'),
        allDay: true,
        guestNames: [],
        declinedByOwner: false,
      },
    ]);
  });

  it('ゲストは主催者を除き表示名(無ければメール)。このカレンダー自身(self)の辞退を拾う', async () => {
    const { client } = fakeClient([
      {
        items: [
          {
            ...reservaEvent,
            summary: '[イベント]全体研修',
            attendees: [
              {
                email: 'takahashi@cutest.biz',
                displayName: '高橋 由美',
                organizer: true,
                responseStatus: 'accepted',
              },
              { email: 'sato@cutest.biz', displayName: '佐藤 美咲', self: true, responseStatus: 'declined' },
              { email: 'suzuki@cutest.biz', responseStatus: 'needsAction' },
            ],
          },
        ],
      },
    ]);
    const [result] = (await new GoogleCalendarApiPort(client).listEvents('sato@cutest.biz', range)).events;
    expect(result?.guestNames).toEqual(['佐藤 美咲', 'suzuki@cutest.biz']);
    expect(result?.declinedByOwner).toBe(true);
  });
});

describe('GoogleCalendarApiPort.freeBusy', () => {
  it('カレンダーごとのbusy時間帯を返し、読めないカレンダーは理由つきのエラーにする', async () => {
    const { client, freeBusyCalls } = fakeClient([], {
      kind: 'calendar#freeBusy',
      calendars: {
        'sato@cutest.biz': {
          busy: [{ start: '2026-09-25T00:00:00Z', end: '2026-09-25T02:00:00Z' }],
        },
        'nobody@cutest.biz': { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] },
      },
    });
    const result = await new GoogleCalendarApiPort(client).freeBusy(
      ['sato@cutest.biz', 'nobody@cutest.biz', 'missing@cutest.biz'],
      range,
    );
    expect(freeBusyCalls[0]).toEqual({
      timeMin: '2026-09-24T15:00:00.000Z',
      timeMax: '2026-09-25T15:00:00.000Z',
      items: [{ id: 'sato@cutest.biz' }, { id: 'nobody@cutest.biz' }, { id: 'missing@cutest.biz' }],
    });
    expect(result.get('sato@cutest.biz')).toEqual({
      busy: [{ start: new Date('2026-09-25T00:00:00Z'), end: new Date('2026-09-25T02:00:00Z') }],
    });
    expect(result.get('nobody@cutest.biz')?.error).toContain('notFound');
    expect(result.get('missing@cutest.biz')?.error).toContain('notFound');
  });

  it('カレンダーが無ければAPIを呼ばない', async () => {
    const { client, freeBusyCalls } = fakeClient([]);
    expect((await new GoogleCalendarApiPort(client).freeBusy([], range)).size).toBe(0);
    expect(freeBusyCalls).toEqual([]);
  });
});
