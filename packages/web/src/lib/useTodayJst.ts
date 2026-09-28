import { useEffect, useState } from 'react';
import { todayJst } from './date';

/** 開いたままの画面で、日付が変わっていないか確かめる間隔 */
export const TODAY_CHECK_INTERVAL_MS = 60_000;

/**
 * 今日(日本時間)'YYYY-MM-DD'。開いたまま日付をまたいだら新しい日付で描画し直す。
 *
 * PWA は開いたまま何日も使われる(タブは一度開くと隠すだけで残る)ため、開いた時点の「今日」を持ち続けると
 * 前の日の予定・週のまま出続ける。画面に戻ってきたとき(visibilitychange / bfcache からの pageshow / focus)と、
 * 開いている間の1分おきに確かめ、日付が変わったときだけ state を変える(同じ日付なら描画し直さない)。
 */
export function useTodayJst(): string {
  const [today, setToday] = useState(() => todayJst());
  useEffect(() => {
    const check = () => setToday(todayJst());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, TODAY_CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
  }, []);
  return today;
}
