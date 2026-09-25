import type { CalendarEventType } from '../model/week';

/** 表(7列)の1時間の高さ(px)。GAS版 CAL_WEEK_HOUR_HEIGHT */
export const WEEK_HOUR_HEIGHT = 40;
/** 1日表示の1時間の高さ(px)。GAS版 CAL_HOUR_HEIGHT */
export const DAY_HOUR_HEIGHT = 48;
/** 時刻の列の幅(px)。GAS版 CAL_TIME_AXIS_WIDTH */
export const TIME_AXIS_WIDTH = 24;

/** 予定の種類ごとの色(GAS版 CAL_TYPE_STYLE) */
export const EVENT_TYPE_STYLE: Record<CalendarEventType, string> = {
  'CUSTOMER APPOINTMENT': 'bg-blue-100 text-blue-800 border-blue-300',
  EVENT: 'bg-teal-100 text-teal-800 border-teal-300',
  'OFFICE WORK': 'bg-gray-200 text-gray-700 border-gray-300',
};

/**
 * 表の入れ物の高さ。最後の時刻の文字が入れ物の下にはみ出して下の説明と重ならないよう 1.5rem 足す
 * (rem なので文字の大きさの設定に合わせて伸びる)。
 */
export const gridContainerHeight = (totalHeight: number) => `calc(${totalHeight}px + 1.5rem)`;
