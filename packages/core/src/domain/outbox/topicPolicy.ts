import { MIRROR_TOPICS, type OutboxTopic, PUSH_TOPICS } from '../model/codes';

/**
 * どのテナントのどのトピックを outbox に積む・送るか(API の UoW とワーカーで同じ規則を使う)。
 *
 * - スプレッドシートへのミラー(mirror.*)は、GAS Bridge の持ち主のテナント(GAS_BRIDGE_TENANT)だけ。
 *   Bridge はそのテナント(キューテスト)の GAS版・スプレッドシートにつながっているため、別のテナントの記録を
 *   送ると、そのテナントの出勤簿・日報に書かれてしまう。
 * - Web Push(push.*)は VAPID が設定されている時だけ(テナントを問わない)。
 */
export interface OutboxTopicPolicy {
  /** ミラーするテナントの slug(MIRROR_TO_GOOGLE_SHEETS が無効なら null。どのテナントもミラーしない)。 */
  mirrorTenantSlug: string | null;
  pushEnabled: boolean;
}

export function isMirrorTopic(topic: OutboxTopic): boolean {
  return MIRROR_TOPICS.includes(topic);
}

/**
 * このテナントの、このトピックを積む・送るか。tenantSlug はミラーのトピックの判定にだけ使う
 * (ミラー以外のトピックでテナントを読みに行かなくてよいよう、関数で受け取る)。
 */
export async function isOutboxTopicEnabled(
  policy: OutboxTopicPolicy,
  topic: OutboxTopic,
  tenantSlug: () => Promise<string>,
): Promise<boolean> {
  if (PUSH_TOPICS.includes(topic)) return policy.pushEnabled;
  if (!isMirrorTopic(topic)) return true;
  if (policy.mirrorTenantSlug === null) return false;
  return (await tenantSlug()) === policy.mirrorTenantSlug;
}
