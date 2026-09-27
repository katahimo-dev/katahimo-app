import { isRecordDate } from '@katahimo/shared';
import { zonedInstant } from '../time/zoned';

/**
 * GAS版のスプレッドシートの日時・時刻のセルの読み取り(移行の取込)。GAS版は Utilities.formatDate(…, "Asia/Tokyo",
 * "yyyy/MM/dd HH:mm:ss") の文字列を appendRow で書き、スプレッドシートがそれを日時の値に変えていた(読むとシリアル値。
 * 手で入れたセルや変換されなかったセルは文字列のまま)。どちらも壁時計時刻として同じ形('yyyy/MM/dd HH:mm:ss')に揃え、
 * 取込のキーと記録の日時にする(テナントのタイムゾーンで絶対時刻にする)。
 */
export interface LegacyWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'yyyy/MM/dd HH:mm:ss'。 */
export function formatLegacyWallClock(w: LegacyWallClock): string {
  return `${w.year}/${pad(w.month)}/${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

function valid(w: LegacyWallClock): LegacyWallClock | null {
  if (w.hour > 23 || w.minute > 59 || w.second > 59) return null;
  return isRecordDate(w.year, w.month, w.day) ? w : null;
}

/**
 * 日時の文字列('2026/09/05 09:00:00'・'2026/9/5 9:00'・'2026-09-05T09:00'・'2026年9月5日 9時0分'・日付だけ等)。
 * 読めない・存在しない日時・記録の年の範囲の外は null。
 */
const TEXT_PATTERN =
  /^(\d{4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?(?:(?:[ T]+|(?<=日))(\d{1,2})[:時](\d{1,2})分?(?::(\d{1,2}))?)?$/;

export function parseLegacyWallClockText(text: string): LegacyWallClock | null {
  const match = TEXT_PATTERN.exec(text.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((v) => Number(v ?? '0')) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return valid({ year, month, day, hour, minute, second });
}

/** スプレッドシートのシリアル値の1日の秒数。 */
const SECONDS_PER_DAY = 86_400;
/** シリアル値の起点(1899-12-30。スプレッドシートの日付の0)。 */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * 日時のシリアル値(1899-12-30 からの日数。小数部が時刻)を壁時計時刻にする(秒に丸める)。記録の年の範囲の外は null。
 * シリアル値はスプレッドシートの壁時計時刻をそのまま表す(タイムゾーンのずれを含まない)。
 */
export function legacyWallClockFromSerial(serial: number): LegacyWallClock | null {
  if (!Number.isFinite(serial)) return null;
  const at = new Date(SERIAL_EPOCH_MS + Math.round(serial * SECONDS_PER_DAY) * 1000);
  return valid({
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
    second: at.getUTCSeconds(),
  });
}

/**
 * 時刻のセルを 'HH:mm' にする。シリアル値(小数部が時刻。日付つきでも時刻だけを見る)か 'H:mm'・'HH:mm'・'HH:mm:ss'
 * の文字列。読めなければ null。
 */
export function legacyTimeOfDay(value: string | number): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const seconds = Math.round((value - Math.floor(value)) * SECONDS_PER_DAY) % SECONDS_PER_DAY;
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}`;
  }
  const match = /^(\d{1,2})[:：](\d{2})(?:[:：]\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** 'yyyy/MM/dd HH:mm:ss'(formatLegacyWallClock の形)を、テナントのタイムゾーンの壁時計時刻として絶対時刻にする。 */
export function legacyWallClockToInstant(wallClock: string, timeZone: string): Date {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(wallClock);
  if (!match) throw new Error(`日時の形が正しくありません: ${wallClock}`);
  const [, y, mo, d, h, mi, s] = match;
  const base = zonedInstant(`${y}-${mo}-${d}`, Number(h) * 60 + Number(mi), timeZone);
  return new Date(base.getTime() + Number(s) * 1000);
}

/** 'yyyy/MM/dd HH:mm:ss' の日付の部分('YYYY-MM-DD')。 */
export function legacyWallClockDate(wallClock: string): string {
  return wallClock.slice(0, 10).replaceAll('/', '-');
}
