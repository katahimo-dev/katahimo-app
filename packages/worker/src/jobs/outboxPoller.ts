import { runOutboxBatch } from '@katahimo/core';
import type { WorkerContainer } from '../container';
import { logJson } from './log';

export interface OutboxPollSummary {
  processed: number;
  retried: number;
  failed: number;
}

/** 全テナントのoutboxを1回ずつ処理する(outbox_jobsはRLS対象のためテナントごとに回す)。 */
export async function pollOutboxOnce(
  container: WorkerContainer,
  batchSize: number,
): Promise<OutboxPollSummary> {
  const total: OutboxPollSummary = { processed: 0, retried: 0, failed: 0 };
  for (const tenant of await container.tenants.listAll()) {
    const result = await runOutboxBatch(container, tenant.id, batchSize);
    if (result.processed + result.retried + result.failed > 0) {
      logJson('INFO', 'outbox バッチを処理しました', { tenant: tenant.slug, ...result });
    }
    total.processed += result.processed;
    total.retried += result.retried;
    total.failed += result.failed;
  }
  return total;
}

/** stop() が呼ばれるまで一定間隔でポーリングし続ける常駐ループ。 */
export async function runOutboxPoller(
  container: WorkerContainer,
  options: { intervalMs: number; batchSize: number; shouldStop: () => boolean },
): Promise<void> {
  while (!options.shouldStop()) {
    try {
      await pollOutboxOnce(container, options.batchSize);
    } catch (error) {
      logJson('ERROR', 'outbox のポーリング中にエラーが発生しました', { error: String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
