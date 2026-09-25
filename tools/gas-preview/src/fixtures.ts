import { SECRET_MASK_CHAR } from '@katahimo/shared';
import { addDays, dayOfWeek } from './dates';
import type { RowData } from './gasRuntime';

/**
 * 見比べ用の架空データ。GAS版のモック(gasMock.ts)と新アプリのAPIモック(webMock.ts)の両方が
 * ここから応答を作るので、同じ内容が両方の画面に出る。形はGAS版(google.script.run の戻り値)に
 * 近い形で持ち、新アプリ用には webMock.ts で契約(@katahimo/shared)の形に直す。
 *
 * 「今日」を引数で受け取り、予定・出勤簿の日付はそこからの相対で作る。
 * 実在の人物・住所ではない。
 */

export interface FixtureStaff {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  /** GAS版モックのログイントークン */
  token: string;
}

export interface FixtureFamilyMember {
  name: string;
  dob: string;
  job: string;
  allergy: string;
  info: string;
}

export interface FixtureCustomer {
  id: string;
  /** 新アプリの顧客ID(UUID) */
  uuid: string;
  name: string;
  kana: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  lat: number;
  lng: number;
  parking: string;
  emergencyContact: string;
  memo: string;
  family: FixtureFamilyMember[];
}

export const TENANT = { id: '00000000-0000-4000-8000-000000000001', slug: 'demo' };

/** パスワードはどのスタッフも 'password'(モックの中だけ)。 */
export const MOCK_PASSWORD = 'password';

export const STAFF: FixtureStaff[] = [
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: '管理者 太郎',
    email: 'admin@example.com',
    isAdmin: true,
    token: 'mock-token-admin',
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    name: '佐藤 美咲',
    email: 'misaki@example.com',
    isAdmin: false,
    token: 'mock-token-staff',
  },
  {
    id: '00000000-0000-4000-8000-0000000000a3',
    name: '鈴木 一郎',
    email: 'ichiro@example.com',
    isAdmin: false,
    token: 'mock-token-staff2',
  },
];

export const ADMIN = STAFF[0] as FixtureStaff;

export function staffByToken(token: unknown): FixtureStaff | undefined {
  return STAFF.find((s) => s.token === token);
}

export const CUSTOMERS: FixtureCustomer[] = [
  {
    id: 'C0001',
    uuid: '00000000-0000-4000-8000-0000000000c1',
    name: '田中 さくら',
    kana: 'タナカ サクラ',
    address: '東京都世田谷区桜新町1-2-3',
    city: '世田谷区',
    phone: '090-1234-5678',
    email: 'sakura.tanaka@example.com',
    lat: 35.6315,
    lng: 139.6446,
    parking: 'あり（家の前に1台）',
    emergencyContact: '090-8765-4321（夫）',
    memo: '玄関のチャイムは鳴らさずにノックしてください',
    family: [
      { name: '田中 ゆい', dob: '2023/04/12', job: '', allergy: '卵', info: '人見知りをする。絵本が好き。' },
      { name: '田中 そうた', dob: '2025/11/03', job: '', allergy: '', info: '' },
      { name: '田中 健', dob: '1990/01/15', job: '会社員', allergy: '', info: '' },
    ],
  },
  {
    id: 'C0002',
    uuid: '00000000-0000-4000-8000-0000000000c2',
    name: '佐々木 あおい',
    kana: 'ササキ アオイ',
    address: '東京都杉並区阿佐谷南2-3-4',
    city: '杉並区',
    phone: '080-2345-6789',
    email: '',
    lat: 35.7021,
    lng: 139.6358,
    parking: 'なし（近くのコインパーキング）',
    emergencyContact: '',
    memo: '',
    family: [{ name: '佐々木 りく', dob: '2024/08/20', job: '', allergy: '', info: 'ミルクは200ml' }],
  },
  {
    id: 'C0003',
    uuid: '00000000-0000-4000-8000-0000000000c3',
    name: '高橋 みお',
    kana: 'タカハシ ミオ',
    address: '神奈川県横浜市青葉区美しが丘3-4-5',
    city: '横浜市青葉区',
    phone: '070-3456-7890',
    email: 'mio@example.com',
    lat: 35.5617,
    lng: 139.5563,
    parking: 'あり',
    emergencyContact: '045-000-0000（実家）',
    memo: '双子',
    family: [
      { name: '高橋 はる', dob: '2022/06/01', job: '', allergy: '小麦', info: '' },
      { name: '高橋 なつ', dob: '2022/06/01', job: '', allergy: '', info: '' },
    ],
  },
  {
    id: 'C0004',
    uuid: '00000000-0000-4000-8000-0000000000c4',
    name: '伊藤 ひなた',
    kana: 'イトウ ヒナタ',
    address: '東京都世田谷区三軒茶屋4-5-6',
    city: '世田谷区',
    phone: '090-4567-8901',
    email: '',
    lat: 35.6436,
    lng: 139.6711,
    parking: '',
    emergencyContact: '',
    memo: '',
    family: [],
  },
];

const byName = (name: string) => CUSTOMERS.find((c) => c.name === name) as FixtureCustomer;

// ── 予定・ルート ──────────────────────────────────────────────

const HOME = { lat: 35.6467, lng: 139.6532 };
const MAPS_DIR = 'https://www.google.com/maps/dir/?api=1';
const dirUrl = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
  `${MAPS_DIR}&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;

export interface FixtureAppointment {
  startTime: string;
  endTime: string;
  customerName: string;
  eventType: 'CUSTOMER APPOINTMENT' | 'OFFICE WORK' | 'EVENT';
  address: string;
  attendanceMin?: number;
  attendanceKm?: number;
  attendanceUrl?: string;
  moveMin?: number;
  moveKm?: number;
  moveUrl?: string;
  leavingMin?: number;
  leavingKm?: number;
  leavingUrl?: string;
}

/** 今日(offset=0)・明日(offset=1)の予定とルート(GAS版 getRouteForStaffOnDate の appointments)。 */
export function routeAppointments(offset: number): FixtureAppointment[] {
  const tanaka = byName('田中 さくら');
  const sasaki = byName('佐々木 あおい');
  const takahashi = byName('高橋 みお');
  const ito = byName('伊藤 ひなた');
  if (offset === 0) {
    return [
      {
        startTime: '09:30',
        endTime: '11:30',
        customerName: tanaka.name,
        eventType: 'CUSTOMER APPOINTMENT',
        address: tanaka.address,
        attendanceMin: 18,
        attendanceKm: 6.2,
        attendanceUrl: dirUrl(HOME, tanaka),
      },
      {
        startTime: '12:30',
        endTime: '14:30',
        customerName: sasaki.name,
        eventType: 'CUSTOMER APPOINTMENT',
        address: sasaki.address,
        moveMin: 25,
        moveKm: 8.4,
        moveUrl: dirUrl(tanaka, sasaki),
      },
      {
        startTime: '15:00',
        endTime: '15:30',
        customerName: '事務作業',
        eventType: 'OFFICE WORK',
        address: '',
      },
      {
        startTime: '16:00',
        endTime: '17:30',
        customerName: takahashi.name,
        eventType: 'CUSTOMER APPOINTMENT',
        address: takahashi.address,
        moveMin: 40,
        moveKm: 15.3,
        moveUrl: dirUrl(sasaki, takahashi),
        leavingMin: 35,
        leavingKm: 12.8,
        leavingUrl: dirUrl(takahashi, HOME),
      },
    ];
  }
  if (offset === 1) {
    return [
      {
        startTime: '10:00',
        endTime: '12:00',
        customerName: ito.name,
        eventType: 'CUSTOMER APPOINTMENT',
        address: ito.address,
        attendanceMin: 8,
        attendanceKm: 2.1,
        attendanceUrl: dirUrl(HOME, ito),
        leavingMin: 9,
        leavingKm: 2.1,
        leavingUrl: dirUrl(ito, HOME),
      },
      { startTime: '13:00', endTime: '14:00', customerName: '研修会', eventType: 'EVENT', address: '' },
    ];
  }
  return [];
}

// ── 出勤簿(個人の出勤簿スプレッドシートの1日1行。列はGAS版 PAST_SCHEDULE_INPUT_COLUMNS) ──

export const WEATHER_OPTIONS = ['晴れ', '雨', '雪'];

const EMPTY_ROW: RowData = {
  C: '',
  D: '',
  E: '',
  AI: '',
  I: '',
  H: '',
  L: '',
  M: '',
  N: '',
  AG: '',
  R: '',
  Q: '',
  U: '',
  V: '',
  W: '',
  AH: '',
  AJ: '',
  X: '',
  Y: '',
  Z: '',
  AA: '',
  AB: '',
  AC: '',
  AN: '',
  AO: '',
};

/** 日付ごとの出勤簿の行。今日より後・土日は空。平日は曜日によって訪問件数を変える。 */
export function attendanceRow(date: string, today: string): RowData {
  if (date > today) return { ...EMPTY_ROW };
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return { ...EMPTY_ROW };
  const rainy = Number(date.slice(8, 10)) % 5 === 0;
  const weather = rainy ? '雨' : '晴れ';
  const row: RowData = {
    ...EMPTY_ROW,
    C: '田中 さくら',
    D: '09:30',
    E: '11:30',
    AI: 6.2,
    I: weather,
  };
  if (dow !== 3) {
    Object.assign(row, { H: 25, L: '佐々木 あおい', M: '12:30', N: '14:30', AG: 8.4, R: weather });
  }
  if (dow === 2 || dow === 4 || dow === 5) {
    Object.assign(row, { Q: 40, U: '高橋 みお', V: '16:00', W: '17:30', AH: 15.3, AJ: 12.8 });
    Object.assign(row, { X: '事務作業', Y: '15:00', Z: '15:30' });
  } else {
    row.AJ = dow === 3 ? 6.2 : 8.9;
  }
  if (dow === 1) Object.assign(row, { AN: 1, AO: '買い物代行あり' });
  return row;
}

/** 月の領収書の合計(GAS版 getAttendanceMonth の receipts)。 */
export function monthReceipts(yearMonth: string, today: string) {
  const byDay: Record<string, number> = {};
  const add = (day: number, amount: number) => {
    const date = `${yearMonth}-${String(day).padStart(2, '0')}`;
    if (date <= today) byDay[date] = (byDay[date] ?? 0) + amount;
  };
  add(3, 1280);
  add(9, 540);
  add(9, 2160);
  add(18, 880);
  add(24, 1500);
  const total = Object.values(byDay).reduce((a, b) => a + b, 0);
  return { byDay, total };
}

/** カレンダーと見比べたときの差分(GAS版 previewCalendarSyncForStaffOnDate の changes)。 */
export function calendarSyncChanges(date: string, today: string) {
  if (date === today) {
    return [
      { col: 'E', label: '#1終業時刻', oldValue: '11:30', newValue: '11:45' },
      { col: 'X', label: '作業１', oldValue: '事務作業', newValue: '' },
    ];
  }
  return [];
}

// ── これまでの記録(GAS版 getCustomerReports) ──────────────────

export interface FixtureReport {
  type: 'daily' | 'accident';
  timestamp: string;
  staff: string;
  original: string;
  internal: string;
  customer: string;
  risk?: number;
  es?: number;
  isAccident?: boolean;
  subtype?: string;
}

export function customerReports(customerId: string, today: string): FixtureReport[] {
  if (customerId !== 'C0001') return [];
  const ts = (daysAgo: number, time: string) => `${addDays(today, -daysAgo).replace(/-/g, '/')} ${time}`;
  const daily = (daysAgo: number, risk: number, es: number, memo: string): FixtureReport => ({
    type: 'daily',
    timestamp: ts(daysAgo, '11:40'),
    staff: '管理者 太郎',
    original: memo,
    internal: `【サポート内容】\n${memo}\n\n【お客様の様子】\nお母様は落ち着いた様子。\n\n【振り返り】\n次回も同じ流れで進める。`,
    customer: `本日もありがとうございました。${memo}`,
    risk,
    es,
  });
  return [
    daily(1, 1, 4, 'ゆいちゃんと公園で遊んだ。そうたくんは午前中よく眠っていた。'),
    {
      type: 'accident',
      timestamp: ts(4, '10:15'),
      staff: '管理者 太郎',
      original: 'ソファから降りるときにつまずきそうになったが支えた',
      internal:
        '【発生時間】10:05\n\n【場所】リビング\n\n【状況】\nソファから降りようとしてバランスを崩した。',
      customer: '',
      isAccident: true,
      subtype: 'ヒヤリハット',
    },
    daily(7, 2, 3, '離乳食の準備と沐浴の補助。'),
    daily(14, 1, 5, '絵本の読み聞かせ。お母様の買い物の間、2人を見守った。'),
    daily(21, 1, 4, '初回訪問。家の中の配置を確認した。'),
    daily(28, 3, 2, 'そうたくんがぐずり気味。抱っこで落ち着いた。'),
    daily(35, 1, 4, '事前面談。'),
  ];
}

// ── 管理者設定 ────────────────────────────────────────────────

/**
 * 新アプリのサーバーは APIキー・Webhook URL を伏せ字にして返す(packages/core/src/usecases/settings.ts の
 * maskApiKey / maskWebhookUrl と同じ形。GAS版は平文を返していた)。見比べでは、GAS版のモックにも同じ伏せ字の値を
 * 返させて、伏せ字以外の見た目を比べる(README「分かっている違い」)。
 */
const MASK = SECRET_MASK_CHAR.repeat(8);

export const ADMIN_SETTINGS = {
  geminiApiKey: `${MASK}0000`,
  reportModel: 'gemini-2.5-flash',
  ocrModel: 'gemini-2.5-flash-lite',
  reportWebhookUrl: `https://chat.googleapis.com/v1/spaces/MOCK/messages?${MASK}`,
  receiptWebhookUrl: `https://chat.googleapis.com/v1/spaces/MOCK/messages?${MASK}`,
};

export const AVAILABLE_MODELS = [
  { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
  { name: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite' },
];

export const DATA_VERSION = '12';

// ── お客様の情報(予定・お客様の担当) ──────────────────────────

/**
 * 顧客CSV(RESERVA)の列名での「住所・連絡先」(本物のGAS版 getData の details と同じ形・同じ並び)。
 * gasMock.ts の customerDetails は仮の列名のため、お客様の情報の場面ではこちらでGAS版の getData を
 * 差しかえる(shots/customers.ts)。新アプリのモック(webMock.ts)は同じ値を項目ごとに返す。
 * 顧客ID・パスワードはGAS版のサーバーが除くので入れない。国番号・世帯全員の情報は新しいAPIに無いため入れない。
 */
export function reservaCustomerDetails(c: FixtureCustomer): Array<{ key: string; value: string }> {
  const [sei = '', mei = ''] = c.name.split(' ');
  const [seiKana = '', meiKana = ''] = c.kana.split(' ');
  return [
    { key: '姓', value: sei },
    { key: '名', value: mei },
    { key: '姓（カナ）※必須項目', value: seiKana },
    { key: '名（カナ）※必須項目', value: meiKana },
    { key: 'メールアドレス', value: c.email },
    { key: '電話番号※必須項目', value: c.phone },
    { key: '会員種別', value: 'Family Sitter 会員' },
    { key: '会員状況（有効／無効）', value: '有効' },
    { key: '会費支払方法（現地決済／銀行振込／口座振替／請求書払い）', value: '口座振替' },
    { key: '会費支払状況（未払／支払済み）', value: '支払済み' },
    { key: '顧客メモ', value: c.memo },
    { key: '登録日時', value: '2025/08/12 13:12' },
    { key: '最終更新日時', value: '' },
    { key: '性別', value: '女' },
    { key: '年代', value: '30代' },
    { key: '住所', value: c.address },
    { key: '駐車場', value: c.parking },
    { key: '駐車場番号・指定場所の詳細など', value: '' },
    { key: '緊急連絡先', value: c.emergencyContact },
    { key: '緊急連絡先の方（申請者との関係性）', value: c.emergencyContact ? '夫' : '' },
    { key: '災害時の避難場所（最寄りの小中学校）', value: '' },
    { key: 'Benefit会員ID', value: '' },
    { key: '住所2', value: '' },
    { key: '住所2[適用開始日YYYY/MM/DD]', value: '' },
    { key: '住所2[適用終了日YYYY/MM/DD]', value: '' },
    { key: '緯度・経度', value: `${c.lat},${c.lng}` },
  ];
}

/** これまでの記録の1件の新アプリ用ID(UUID)。GAS版の記録にはIDが無いため並び順から作る。 */
export function reportUuid(customerIndex: number, reportIndex: number): string {
  return `00000000-0000-4000-8000-${(customerIndex * 1000 + reportIndex + 1).toString(16).padStart(12, '0')}`;
}
