import { type PushNotice, scheduleLinkPath } from '@katahimo/shared';
import type { ScheduleAppointmentLight } from '../../ports/schedule';
import { addDays } from '../calendarDate';
import { zonedBusinessDate } from '../time';

/**
 * 翌日の予定のお知らせ(Web Push)の文面。GAS版 gas-root-serach の夜間の LINE WORKS DM「【明日の予定: …】」を
 * 置き換える。端末の通知に出るため短くし、表示名と時刻だけを入れる(住所・電話番号・ルートの URL は入れない。
 * 通知を押すとアプリの予定タブで翌日の予定・ルートを開く)。
 */

/** 本文に並べる予定の行数の上限(超える分は最後の行を「ほか N件」にする)。 */
export const ROUTE_NOTICE_MAX_LINES = 5;
/** 1行に出す名前の文字数の上限(超える分は「…」)。 */
export const ROUTE_NOTICE_NAME_MAX_CHARS = 16;
/** 端末がオフラインの間、プッシュサービスが届けるのを待つ時間(翌日の予定のため1日)。 */
export const ROUTE_NOTICE_TTL_SECONDS = 24 * 60 * 60;
/** テスト通知を待つ時間。 */
export const TEST_NOTICE_TTL_SECONDS = 60 * 60;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const CUSTOMER_APPOINTMENT = 'CUSTOMER APPOINTMENT';

/** 'YYYY-MM-DD' → '9/27(土)'(曜日は暦の上で数える)。 */
export function formatNoticeDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
}

function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text.trim());
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join('')}…` : chars.join('');
}

/** '10:00〜12:00 山田 花子様'(お客様の予定だけ「様」を付ける。事務・イベントは予定名のまま)。 */
export function routeNoticeLine(
  appointment: Pick<ScheduleAppointmentLight, 'title' | 'eventType' | 'start' | 'end'>,
) {
  const name = truncate(appointment.title, ROUTE_NOTICE_NAME_MAX_CHARS);
  const suffix = appointment.eventType === CUSTOMER_APPOINTMENT && name ? '様' : '';
  return `${appointment.start}〜${appointment.end} ${name}${suffix}`.trim();
}

/** 通知の本文。ROUTE_NOTICE_MAX_LINES 行を超える場合は、最後の行を「ほか N件」にする。 */
export function routeNoticeBody(appointments: readonly ScheduleAppointmentLight[]): string {
  const lines = appointments.map(routeNoticeLine);
  if (lines.length <= ROUTE_NOTICE_MAX_LINES) return lines.join('\n');
  const shown = lines.slice(0, ROUTE_NOTICE_MAX_LINES - 1);
  return [...shown, `ほか${lines.length - shown.length}件`].join('\n');
}

/**
 * date(翌日)の予定のお知らせ。タイトルは「明日の予定 9/27(土) 3件」、押すと予定タブで date の予定を開く。
 * tag は日付ごとに同じ(送り直しても端末の上で置き換わり、二重に出ない)。
 */
export function buildRouteNotice(
  date: string,
  appointments: readonly ScheduleAppointmentLight[],
): PushNotice {
  return {
    title: `明日の予定 ${formatNoticeDate(date)} ${appointments.length}件`,
    body: routeNoticeBody(appointments),
    url: scheduleLinkPath(date),
    tag: `route-notice-${date}`,
  };
}

/** プッシュサービスの上で同じ日のお知らせをまとめる topic(base64url の文字だけ・32文字まで)。 */
export function routeNoticeTopic(date: string): string {
  return `route-${date.replaceAll('-', '')}`;
}

/** 設定画面の「テスト通知を送る」の通知。 */
export function buildTestNotice(): PushNotice {
  return {
    title: 'テスト通知',
    body: 'この端末に通知が届くことを確かめました。',
    url: '/',
    tag: 'test-notice',
  };
}

/** now の時点でのテナントのタイムゾーンの「明日」('YYYY-MM-DD')。 */
export function tomorrowInTimeZone(now: Date, timeZone: string): string {
  return addDays(zonedBusinessDate(now, timeZone), 1);
}

/**
 * お知らせを送るスタッフ: date に在籍している(activeStaff)うち、通知の購読を1つ以上持つスタッフ(並びは activeStaff の順)。
 * 予定が無いスタッフには送らない(予定を読んだ後に呼び出し側が判断する。GAS版も予定の無いスタッフには送らない)。
 */
export function selectRouteNoticeTargets<T extends { id: string }>(
  activeStaff: readonly T[],
  subscribedStaffIds: readonly string[],
): T[] {
  const subscribed = new Set(subscribedStaffIds);
  return activeStaff.filter((staff) => subscribed.has(staff.id));
}
