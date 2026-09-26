const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 次に JST の hour:minute になる時刻(now がちょうどその時刻なら翌日)。 */
export function nextJstOccurrence(now: Date, hour: number, minute: number): Date {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const todayTarget = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate(),
    hour,
    minute,
  );
  const target = todayTarget > jstNow.getTime() ? todayTarget : todayTarget + DAY_MS;
  return new Date(target - JST_OFFSET_MS);
}

/**
 * ローカル開発用の簡易スケジューラ: 毎日 JST の hour:minute に task を実行する。
 * 本番は Cloud Scheduler → Cloud Run Jobs で動かす(doc/05_バッチ・外部連携.md 3章)。戻り値で停止できる。
 */
export function scheduleDailyJst(hour: number, minute: number, task: () => Promise<void>): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const arm = (): void => {
    if (stopped) return;
    const delay = nextJstOccurrence(new Date(), hour, minute).getTime() - Date.now();
    timer = setTimeout(async () => {
      await task().catch(() => undefined);
      arm();
    }, delay);
  };
  arm();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
