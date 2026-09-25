/**
 * GAS版 RouteSearch.js と GoogleSchedulePort に同じ入力を与えて結果を比べるためのシナリオ
 * (gasParity.test.ts)。実運用の予定の入り方(RESERVAの予約確定・スタッフが入れる[事務]等・
 * オンライン相談・住所2・招待・辞退・終日予定・タグ無しの私用)を1日分に詰め込んでいる。
 */
export interface ScenarioEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  /** JSTの 'YYYY-MM-DD HH:mm' */
  start: string;
  end: string;
  allDay?: boolean;
  guests?: Array<{ name: string; email: string }>;
  declined?: boolean;
}

export interface ScenarioCalendar {
  /** カレンダー名(GAS版ではこれが持ち主のスタッフ名として使われる) */
  name: string;
  events: ScenarioEvent[];
}

export interface ScenarioCustomer {
  id: string;
  name: string;
  address: string;
  latLng?: [number, number];
  address2?: { address: string; start: string; end: string };
}

export interface ScenarioStaff {
  name: string;
  address: string;
  latLng?: [number, number];
}

export interface Scenario {
  date: string;
  calendars: ScenarioCalendar[];
  customers: ScenarioCustomer[];
  staff: ScenarioStaff[];
  /** ジオコーディング結果(載っていない住所は ZERO_RESULTS) */
  geocode: Record<string, [number, number]>;
}

const reserva = (staff: string, id: string, extra = '') =>
  [
    `予約番号：${id}`,
    `施設：${staff}[訪問保育]`,
    `メニュー：ベビーシッター${extra}`,
    `予約詳細：https://reserva.be/cutest/reservation/detail?id=${id}`,
  ].join('\n');

export const gasScenario: Scenario = {
  date: '2026-09-25',
  calendars: [
    {
      name: 'info@cutest.biz',
      events: [
        {
          id: 'r1',
          title: '[予約確定]山田 花子',
          description: reserva('佐藤 美咲', 'R1'),
          start: '2026-09-25 09:00',
          end: '2026-09-25 11:00',
        },
        {
          id: 'r2',
          title: '[予約確定]鈴木一郎',
          description: reserva('佐藤　美咲', 'R2'),
          start: '2026-09-25 13:00',
          end: '2026-09-25 15:00',
        },
        {
          id: 'r3',
          title: '[予約確定]田中 美和',
          description: reserva('佐藤 美咲', 'R3', '(オンライン相談)'),
          start: '2026-09-25 11:30',
          end: '2026-09-25 12:00',
        },
        {
          id: 'r4',
          title: '[予約確定]未登録 太郎',
          description: reserva('佐藤 美咲', 'R4'),
          start: '2026-09-25 16:00',
          end: '2026-09-25 17:00',
        },
        {
          id: 'r5',
          title: '[予約確定]山田 花子',
          description: reserva('高橋 由美', 'R5'),
          start: '2026-09-25 18:00',
          end: '2026-09-25 19:00',
        },
        {
          id: 'r6',
          title: '[予約確定]伊藤 健',
          description: '予約番号：R6',
          start: '2026-09-25 08:00',
          end: '2026-09-25 08:15',
        },
        {
          id: 'r7',
          title: '[予約確定]山田 花子',
          description: reserva('佐藤 美咲', 'R7'),
          start: '2026-09-25 20:00',
          end: '2026-09-25 21:00',
          declined: true,
        },
        {
          id: 'prev',
          title: '[予約確定]山田 花子',
          description: reserva('佐藤 美咲', 'P'),
          start: '2026-09-24 20:00',
          end: '2026-09-25 00:00',
        },
        {
          id: 'next',
          title: '[予約確定]山田 花子',
          description: reserva('佐藤 美咲', 'N'),
          start: '2026-09-26 00:00',
          end: '2026-09-26 02:00',
        },
      ],
    },
    {
      name: '佐藤 美咲',
      events: [
        { id: 'o1', title: '[事務]日報作成', start: '2026-09-25 12:00', end: '2026-09-25 12:30' },
        {
          id: 'o2',
          title: '[事務]請求書',
          location: '東京都渋谷区道玄坂1-1',
          start: '2026-09-25 12:15',
          end: '2026-09-25 13:00',
        },
        { id: 'o3', title: '[事務]電話対応', start: '2026-09-25 17:30', end: '2026-09-25 18:00' },
        {
          id: 'ev1',
          title: '[イベント]全体研修',
          location: '東京都渋谷区道玄坂1-1',
          start: '2026-09-25 19:00',
          end: '2026-09-25 20:00',
          guests: [
            { name: '佐藤 美咲', email: 'sato@cutest.biz' },
            { name: '高橋由美', email: 'takahashi@cutest.biz' },
          ],
        },
        { id: 'shared1', title: '[事務]打合せ', start: '2026-09-25 15:30', end: '2026-09-25 15:45' },
        {
          id: 'p1',
          title: '歯医者',
          location: '東京都世田谷区',
          start: '2026-09-25 07:00',
          end: '2026-09-25 07:30',
        },
        {
          id: 'r7',
          title: '[予約確定]山田 花子',
          description: reserva('佐藤 美咲', 'R7'),
          start: '2026-09-25 20:00',
          end: '2026-09-25 21:00',
        },
      ],
    },
    {
      name: '高橋 由美',
      events: [
        {
          id: 'n1',
          title: '[新規]小林様 体験訪問',
          location: '東京都杉並区荻窪5-1-1',
          start: '2026-09-25 10:00',
          end: '2026-09-25 11:00',
        },
        { id: 'n2', title: '[新規]場所未定の体験', start: '2026-09-25 14:00', end: '2026-09-25 15:00' },
        { id: 'shared1', title: '[事務]打合せ', start: '2026-09-25 15:30', end: '2026-09-25 15:45' },
        { id: 'o5', title: '[事務]打合せ', start: '2026-09-25 15:50', end: '2026-09-25 16:00' },
        { id: 'o4', title: '[事務]棚卸し', start: '2026-09-25 00:00', end: '2026-09-26 00:00', allDay: true },
        {
          id: 'ev2',
          title: '[イベント]個人研修',
          location: '存在しない住所',
          start: '2026-09-25 16:00',
          end: '2026-09-25 17:00',
        },
      ],
    },
  ],
  customers: [
    { id: 'C0001', name: '山田 花子', address: '東京都世田谷区三軒茶屋1-2-3', latLng: [35.6437, 139.6708] },
    {
      id: 'C0002',
      name: '鈴木 一郎',
      address: '東京都目黒区自由が丘2-10-1',
      latLng: [35.6074, 139.6687],
      address2: { address: '神奈川県横浜市青葉区美しが丘1-1', start: '2026-09-20', end: '2026-09-30' },
    },
    { id: 'C0003', name: '田中 美和', address: '東京都渋谷区恵比寿4-5-6', latLng: [35.6467, 139.7101] },
    { id: '', name: '伊藤 健', address: '東京都品川区大崎1-1-1' },
  ],
  staff: [
    { name: '佐藤 美咲', address: '東京都世田谷区用賀4-1-1', latLng: [35.6264, 139.6336] },
    { name: '高橋 由美', address: '東京都中野区中野5-1-1' },
  ],
  geocode: {
    '神奈川県横浜市青葉区美しが丘1-1': [35.5689, 139.5577],
    '東京都渋谷区道玄坂1-1': [35.6581, 139.6975],
    '東京都杉並区荻窪5-1-1': [35.7046, 139.6203],
    '東京都中野区中野5-1-1': [35.7074, 139.6654],
    '東京都品川区大崎1-1-1': [35.6197, 139.7286],
  },
};

/** 決定的な疑似経路(GAS版のDirectionFinderと新実装のRoutes APIの両方の偽物が同じ値を返す)。 */
export function fakeRoute(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
  const distanceMeters =
    Math.round(
      Math.abs(origin.lat - destination.lat) * 111_000 + Math.abs(origin.lng - destination.lng) * 91_000,
    ) + 137;
  return { distanceMeters, durationSeconds: Math.round(distanceMeters / 8.3) + 43 };
}
