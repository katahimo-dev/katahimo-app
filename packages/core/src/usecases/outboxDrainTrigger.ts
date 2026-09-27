import type { OutboxDrainTriggerPort } from '../ports/outbox';
import type { TenantRepositories, UnitOfWorkOptions, UnitOfWorkPort } from '../ports/unitOfWork';

/**
 * 1つの API インスタンスが outbox-drain の実行を頼む最短の間隔の既定。ジョブの起動(依頼から DB を読み始めるまで10〜30秒)
 * より短くしておくと、間隔の中でコミットされたメッセージは、直前に頼んだ実行(起動中か処理中)が空になるまで取り出す中で拾う。
 */
export const DEFAULT_OUTBOX_DRAIN_TRIGGER_COOLDOWN_MS = 5_000;

/** 起動の依頼に失敗したときのログ(プロセスの構造化ログ。テナントの操作ログではない)。 */
export interface OutboxDrainTriggerFailure {
  action: 'outbox.drain_trigger_failed';
  message: string;
  error: string;
}

export interface OutboxDrainNotifierOptions {
  trigger: OutboxDrainTriggerPort;
  /** 依頼に失敗したときに WARN で書く。 */
  warn: (failure: OutboxDrainTriggerFailure) => void;
  /** この間隔の中では依頼を1回にまとめる(省略時は DEFAULT_OUTBOX_DRAIN_TRIGGER_COOLDOWN_MS)。 */
  cooldownMs?: number;
}

/**
 * outbox に積んだことを受けて outbox-drain の実行を頼む(API インスタンスごとに1つ)。
 *
 * - 前回の依頼から cooldownMs 以上経っていれば、すぐに頼む(依頼が受け付けられるまで待つ)。
 * - 間隔の中では頼まない。間隔は実行の起動より短いため、間隔の中でコミットされたメッセージは直前に頼んだ実行が
 *   空になるまで取り出す中で拾う。間隔が明けた後に積まれれば、そのリクエストの中でまた頼む。タイマーは使わない
 *   (Cloud Run の API はリクエストの処理中しか CPU が割り当てられず、リクエストの外で動く処理は遅れたり失敗したりする)。
 *   直前の実行が先に終わっていて拾えなかった分は、定期実行の見回り(Cloud Scheduler → outbox-drain、10分ごと)が拾う。
 * - 依頼の失敗は例外にせず WARN `outbox.drain_trigger_failed` を書くだけにする(利用者の操作は成功のまま。
 *   積んだメッセージは見回りが処理する)。
 *
 * 同じメッセージを複数の実行が取り合っても、取り出しは FOR UPDATE SKIP LOCKED なので二重には処理しない。
 */
export class OutboxDrainNotifier {
  private readonly cooldownMs: number;
  private lastRequestedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: OutboxDrainNotifierOptions) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_OUTBOX_DRAIN_TRIGGER_COOLDOWN_MS;
  }

  /** outbox に積んだトランザクションがコミットされた後に、リクエストの処理の中で呼ぶ。例外は投げない。 */
  async notify(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRequestedAt < this.cooldownMs) return;
    this.lastRequestedAt = now;
    await this.request();
  }

  private async request(): Promise<void> {
    try {
      await this.options.trigger.requestDrain();
    } catch (error) {
      this.options.warn({
        action: 'outbox.drain_trigger_failed',
        message: 'outbox の処理(outbox-drain)の起動を頼めませんでした。定期実行の見回りで処理します',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * outbox に1件でも積んだ run がコミットされたら notifier に知らせる Unit of Work。積まなかった run・
 * ロールバックした run(work が例外を投げた)では知らせない。知らせるのはコミットの後(トランザクションの外)で、
 * 依頼が受け付けられるまで run の呼び出し元に戻らない(リクエストの処理中に依頼を終える)。
 */
export function withOutboxDrainTrigger(
  uow: UnitOfWorkPort,
  notifier: Pick<OutboxDrainNotifier, 'notify'>,
): UnitOfWorkPort {
  return {
    async run<T>(
      tenantId: string,
      work: (repos: TenantRepositories) => Promise<T>,
      options?: UnitOfWorkOptions,
    ): Promise<T> {
      let enqueued = false;
      const result = await uow.run(
        tenantId,
        (repos) =>
          work({
            ...repos,
            outbox: {
              async enqueue(message) {
                const queued = await repos.outbox.enqueue(message);
                if (queued) enqueued = true;
                return queued;
              },
              latestPayload: (topic, aggregateId) => repos.outbox.latestPayload(topic, aggregateId),
            },
          }),
        options,
      );
      if (enqueued) await notifier.notify();
      return result;
    },
  };
}
