/**
 * 停止の合図(SIGTERM・SIGINT)。ジョブは区切りごとに stopped を確かめ、待ち時間は sleep で待つ
 * (合図が来たらすぐに起きる)。
 */
export class StopSignal {
  private stoppedFlag = false;
  private readonly waiters = new Set<() => void>();

  get stopped(): boolean {
    return this.stoppedFlag;
  }

  stop(): void {
    if (this.stoppedFlag) return;
    this.stoppedFlag = true;
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  /** ms 待つ。途中で stop() されたらすぐに戻る。 */
  sleep(ms: number): Promise<void> {
    if (this.stoppedFlag) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  /** SIGTERM・SIGINT で stop() する。 */
  listen(onStop?: (signal: NodeJS.Signals) => void): this {
    const handler = (signal: NodeJS.Signals) => {
      this.stop();
      onStop?.(signal);
    };
    process.once('SIGTERM', handler);
    process.once('SIGINT', handler);
    return this;
  }
}
