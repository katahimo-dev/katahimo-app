/**
 * テナントのタイムゾーン(tenants.timezone、IANA名)での壁時計時刻と絶対時刻の変換。
 * 出勤簿・予定の時刻は「その業務日のテナントの壁時計時刻('HH:mm')」で入力され、DBには絶対時刻の
 * 範囲(tstzrange)で保存する。サーバー・DB接続のタイムゾーンには依存しない。
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockOf(instant: Date, timeZone: string): WallClock {
  const parts = formatterOf(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** instant におけるタイムゾーンのUTCからのずれ(ミリ秒)。 */
function offsetMs(instant: Date, timeZone: string): number {
  const w = wallClockOf(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** 'YYYY-MM-DD' の日付に分(0〜。1440以上は翌日以降)を足した壁時計時刻の絶対時刻。 */
export function zonedInstant(businessDate: string, minutesOfDay: number, timeZone: string): Date {
  const [y, m, d] = businessDate.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutesOfDay, 0);
  // 1回目の近似でずれを求め、夏時間の境界をまたぐ場合に備えてもう一度合わせる
  const first = naive - offsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs(new Date(first), timeZone));
}

/** 業務日の [0:00, 翌0:00)。 */
export function zonedDayRange(businessDate: string, timeZone: string): { from: Date; to: Date } {
  return { from: zonedInstant(businessDate, 0, timeZone), to: zonedInstant(businessDate, 24 * 60, timeZone) };
}

/** 絶対時刻をタイムゾーンの 'YYYY-MM-DD'(業務日)にする。 */
export function zonedBusinessDate(instant: Date, timeZone: string): string {
  const w = wallClockOf(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** 絶対時刻を業務日の0:00からの分にする(翌日にまたがる場合は1440以上)。 */
export function minutesSinceZonedMidnight(instant: Date, businessDate: string, timeZone: string): number {
  return Math.round((instant.getTime() - zonedInstant(businessDate, 0, timeZone).getTime()) / 60_000);
}
