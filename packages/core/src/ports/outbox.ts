import type { ChangeSource, EntityType, OutboxTopic } from '../domain/model';

export interface OutboxMessageInput {
  topic: OutboxTopic;
  aggregateType: string;
  aggregateId: string;
  /** 決定的な重複排除キー(`<topic>:<aggregate_id>:<版>`。domain/outbox の outboxDedupeKey)。 */
  dedupeKey: string;
  /** ID 等だけ(個人情報を入れない)。 */
  payload?: Record<string, unknown>;
}

/**
 * outbox への積み込み(UoW のトランザクションに結び付く。ドメインの書き込みと同時にコミット・ロールバックされる)。
 * 同じ dedupe_key の再積み込みは何もしない。スプレッドシートへのミラーを無効にしている環境では
 * ミラーのトピックを積まない(実装が設定で判断する)。
 */
export interface OutboxWriter {
  enqueue(message: OutboxMessageInput): Promise<void>;
}

/** ワーカーが1件ずつ取り出したメッセージ。 */
export interface ClaimedOutboxMessage {
  id: string;
  tenantId: string;
  topic: OutboxTopic;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** 今回を含めた試行回数。 */
  attempts: number;
  maxAttempts: number;
}

/**
 * ワーカー側の outbox(テナントを横断して取る。katahimo_worker 用のポリシーがある)。取り出しは
 * FOR UPDATE SKIP LOCKED で1件ずつ、locked_until(リース)を付けて processing にする。リースが切れた
 * processing は別のワーカーが取り直す。
 */
export interface OutboxQueuePort {
  claimNext(workerId: string, leaseMs: number, now: Date): Promise<ClaimedOutboxMessage | null>;
  complete(id: string, tenantId: string, now: Date): Promise<void>;
  retry(id: string, tenantId: string, error: string, availableAt: Date): Promise<void>;
  /** これ以上試さない(dead: 試行回数の上限 / failed: 再試行しても直らない失敗)。 */
  giveUp(id: string, tenantId: string, error: string, status: 'failed' | 'dead', now: Date): Promise<void>;
}

export interface EntityChangeInput {
  id: string;
  entityType: EntityType;
  entityId: string;
  changedBy: string | null;
  changeSource: ChangeSource;
  changedFields: string[];
  /** 変更前の値(JSON を entity_changes.before の用途・この行のIDで暗号化したもの)。 */
  beforeEnc: Uint8Array | null;
}

/** 実体の変更履歴(追記のみ)。 */
export interface EntityChangeWriter {
  append(change: EntityChangeInput): Promise<void>;
}
