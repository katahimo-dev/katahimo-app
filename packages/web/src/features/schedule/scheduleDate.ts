/**
 * 予定タブの日付(GAS版 loadScheduleForOffset_ の日付の計算と「9月3日（水）今日」の表記)。
 * 業務日はJSTで数える(端末の時刻帯が日本以外でも、日付がずれないように)。
 */

/** ☀️今日 = 0 / 🌙明日 = 1 */
export type ScheduleOffset = 0 | 1;

export interface ScheduleDate {
  /** 'YYYY-MM-DD'(JST) */
  dateStr: string;
  /** 「9月3日（水）今日」 */
  label: string;
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function scheduleDateFor(offset: ScheduleOffset, now: Date = new Date()): ScheduleDate {
  // JSTの壁時計の時刻をUTCの値として持つDateにして、UTCの日付として数える
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  jst.setUTCDate(jst.getUTCDate() + offset);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dow = DOW_LABELS[jst.getUTCDay()];
  const suffix = offset === 0 ? '今日' : '明日';
  return { dateStr, label: `${m}月${d}日（${dow}）${suffix}` };
}

/** 「HH:MM 時点」(GAS版 renderScheduleWithRoute の scheduleRouteMeta)。JSTで表す。 */
export function formatRouteFetchedAt(ts: number): string {
  const jst = new Date(ts + JST_OFFSET_MS);
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} 時点`;
}
