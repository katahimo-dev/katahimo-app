import type { OutboxTopic } from '../model';

/**
 * outbox の重複排除キー `<topic>:<aggregate_id>:<版>`。同じ書き込み(同じ版)をやり直しても同じキーになり、
 * 二重に積まれない(outbox_messages の (tenant_id, dedupe_key) の UNIQUE)。版は row_version、
 * 変わらない行は 0、中身から決まる送信(勤怠集計)は内容の指紋を使う。
 */
export function outboxDedupeKey(topic: OutboxTopic, aggregateId: string, version: number | string): string {
  return `${topic}:${aggregateId}:${version}`;
}

/** 送信は再試行しても直らない(対象の行が消えた等)。ワーカーは再試行せず failed にする。 */
export class PermanentOutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentOutboxError';
  }
}
