import { useEffect, useState } from 'react';

/**
 * GAS版のダイアログの開き方・閉じ方(フェード)を再現するフック。
 *
 * GAS版は開くとき `hidden` を外し、10ms後に `opacity-0` を外す(=CSSのtransitionでふわっと出る)。
 * 閉じるときは `opacity-0` を付け、300ms後に `hidden` を付ける。
 *
 * @returns mounted: 画面に置くか(false = GAS版の hidden)、shown: 不透明にするか(false = opacity-0)
 */
export function useFadeTransition(open: boolean, { enterDelayMs = 10, exitMs = 300 } = {}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const timer = setTimeout(() => setShown(true), enterDelayMs);
      return () => clearTimeout(timer);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, enterDelayMs, exitMs]);

  return { mounted, shown };
}
