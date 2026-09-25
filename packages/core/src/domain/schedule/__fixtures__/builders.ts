import type { Appointment, CalendarEvent, CalendarEventSource, ScheduleCustomer } from '../types';

/** テスト用: JSTの壁時計時刻 'YYYY-MM-DD HH:mm' を Date にする。 */
export function jst(dateTime: string): Date {
  return new Date(`${dateTime.replace(' ', 'T')}:00+09:00`);
}

let sequence = 0;

/** Google Calendar から読んだ予定1件(既定値は2026-09-25 10:00〜12:00・タグ無し)。 */
export function calendarEvent(
  overrides: Partial<CalendarEvent> & { at?: [string, string] } = {},
): CalendarEvent {
  const { at, ...rest } = overrides;
  sequence += 1;
  return {
    dedupeKey: `event-${sequence}@google.com`,
    title: '',
    description: '',
    location: '',
    start: jst(at?.[0] ?? '2026-09-25 10:00'),
    end: jst(at?.[1] ?? '2026-09-25 12:00'),
    allDay: false,
    guestNames: [],
    declinedByOwner: false,
    ...rest,
  };
}

export function source(ownerName: string, events: CalendarEvent[]): CalendarEventSource {
  return { ownerName, events };
}

/** RESERVAが作る予約確定イベントの説明欄(実データの書式に合わせた例)。 */
export function reservaDescription(
  staffName: string,
  options: { online?: boolean; reservationId?: string } = {},
) {
  const id = options.reservationId ?? '1234567';
  return [
    `予約番号：${id}`,
    `施設：${staffName}[訪問保育]`,
    `メニュー：${options.online ? 'オンライン相談 60分' : 'ベビーシッター 2時間'}`,
    '予約者：山田 花子 様',
    `予約詳細：https://reserva.be/cutest/reservation/detail?id=${id}&tab=info`,
  ].join('\n');
}

export const customers: ScheduleCustomer[] = [
  {
    customerId: 'C0001',
    name: '山田 花子',
    place: { address: '東京都世田谷区三軒茶屋1-2-3', latLng: { lat: 35.6437, lng: 139.6708 } },
  },
  {
    customerId: 'C0002',
    name: '鈴木 一郎',
    place: {
      address: '東京都目黒区自由が丘2-10-1',
      latLng: null,
      temporaryAddress: {
        address: '神奈川県横浜市青葉区美しが丘1-1',
        startDate: '2026-09-20',
        endDate: '2026-09-30',
      },
    },
  },
  { customerId: '', name: '田中　美和', place: { address: '東京都渋谷区恵比寿4-5-6', latLng: null } },
];

export function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    type: 'CUSTOMER APPOINTMENT',
    start: jst('2026-09-25 10:00'),
    end: jst('2026-09-25 12:00'),
    name: '山田 花子',
    customerId: 'C0001',
    place: { address: '東京都世田谷区三軒茶屋1-2-3', latLng: { lat: 35.6437, lng: 139.6708 } },
    reservaUrl: '',
    assigneeNames: ['佐藤 美咲'],
    ...overrides,
  };
}
