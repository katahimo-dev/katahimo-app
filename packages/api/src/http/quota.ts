import type { RateLimitRule } from '@katahimo/core/domain';
import { consumeQuota } from '@katahimo/core/usecases';
import type { Context } from 'hono';
import type { Container } from '../container';
import type { SessionEnv } from '../session';
import { requestMeta } from './requestMeta';
import { rateLimited } from './responses';

/**
 * ログイン中スタッフ単位の利用回数(従量課金のAI・地図API)を1回分数え、上限を超えていれば 429 の応答を
 * 返す(超えていなければ null)。超えた記録は WARN `rate_limit.exceeded` に残る。
 */
export async function enforceStaffQuota(
  c: Context<SessionEnv>,
  container: Container,
  rule: RateLimitRule,
  message: string,
): Promise<Response | null> {
  const session = c.get('session');
  const decision = await consumeQuota(container, rule, `${session.tenantId}:${session.staffId}`, {
    tenantId: session.tenantId,
    actorStaffId: session.staffId,
    meta: requestMeta(c),
  });
  return decision.allowed ? null : rateLimited(c, decision.retryAfterMs, message);
}
