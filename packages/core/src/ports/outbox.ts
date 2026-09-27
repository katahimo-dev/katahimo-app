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
  /** 積んだら true。同じ dedupe_key が積み済み・積まないトピックなら false。 */
  enqueue(message: OutboxMessageInput): Promise<boolean>;
  /** 同じトピック・同じ対象の、最後に積んだメッセージのペイロード(無ければ null)。 */
  latestPayload(topic: OutboxTopic, aggregateId: string): Promise<Record<string, unknown> | null>;
}

/** ワーカーが1件ずつ取り出したメッセージ(リース)。 */
export interface ClaimedOutboxMessage {
  id: string;
  tenantId: string;
  topic: OutboxTopic;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** 今回を含めた試行回数(リースの識別にも使う)。 */
  attempts: number;
  maxAttempts: number;
  /** 取り出したワーカー(locked_by)。 */
  lockedBy: string;
}

/** リースが切れたまま試行回数の上限に達したため dead にしたメッセージ。 */
export interface ExpiredOutboxMessage {
  id: string;
  tenantId: string;
  topic: OutboxTopic;
  aggregateId: string;
  attempts: number;
}

/**
 * ワーカー側の outbox(テナントを横断して取る。katahimo_worker 用のポリシーがある)。取り出しは
 * FOR UPDATE SKIP LOCKED で1件ずつ、locked_until(リース)を付けて processing にする。リースが切れた
 * processing は別のワーカーが取り直す(試行回数の上限に達していれば取り直さず dead)。
 *
 * complete / retry / giveUp は、取り出したときのリース(locked_by と attempts)がまだ自分のものである場合だけ書き、
 * 書いたかどうかを返す。リースが切れて別のワーカーが取り直した後に、遅れて終わった古い処理が結果を上書きしない。
 */
export interface OutboxQueuePort {
  claimNext(workerId: string, leaseMs: number, now: Date): Promise<ClaimedOutboxMessage | null>;
  /** リースが切れたまま試行回数の上限に達した processing を dead にする。 */
  expireExhaustedLeases(now: Date, error: string): Promise<ExpiredOutboxMessage[]>;
  complete(lease: ClaimedOutboxMessage, now: Date): Promise<boolean>;
  retry(lease: ClaimedOutboxMessage, error: string, availableAt: Date): Promise<boolean>;
  /** これ以上試さない(dead: 試行回数の上限 / failed: 再試行しても直らない失敗)。 */
  giveUp(lease: ClaimedOutboxMessage, error: string, status: 'failed' | 'dead', now: Date): Promise<boolean>;
}

export interface EntityChangeInput {
  id: string;
  entityType: EntityType;
  entityId: string;
  changedBy: string | null;
  changeSource: ChangeSource;
  changedFields: string[];
  /** 変更前の値(更新は変わった項目、削除は全項目)。 */
  before: Record<string, unknown> | null;
}

/** 実体の変更履歴(追記のみ)。 */
export interface EntityChangeWriter {
  append(change: EntityChangeInput): Promise<void>;
}

/**
 * outbox を処理するジョブ(本番は Cloud Run Jobs の outbox-drain)の1回の実行を頼む。依頼が受け付けられたら
 * 戻り、ジョブの完了は待たない。依頼できなかったら例外を投げる(呼ぶ側は利用者の操作を失敗させず、
 * 定期実行の見回りに任せる。usecases/outboxDrainTrigger.ts)。
 */
export interface OutboxDrainTriggerPort {
  requestDrain(): Promise<void>;
}
