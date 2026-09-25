import { useEffect, useState } from 'react';

/**
 * 始めてからの秒数(1秒ごとに数え直す)。AI生成・保存の「…（N秒）」の表示に使う(GAS版 startLoadingUI)。
 * startedAt が null のあいだは数えない。
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
