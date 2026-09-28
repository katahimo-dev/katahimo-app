import type { RateLimitRule } from '@katahimo/core/domain';
import { consumeQuota } from '@katahimo/core/usecases';
import type { Context } from 'hono';
import type { Container } from '../container';
import type { SessionEnv } from '../session';
import { DEMO_AI_QUOTA_MESSAGE, DEMO_AI_SESSION_RULE } from './demoRestrictions';
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
  const context = { tenantId: session.tenantId, actorStaffId: session.staffId, meta: requestMeta(c) };
  const decision = await consumeQuota(container, rule, `${session.tenantId}:${session.staffId}`, context);
  return decision.allowed ? null : rateLimited(c, decision.retryAfterMs, message);
}

/**
 * AI(Gemini の従量課金)の利用回数を数える。スタッフ単位の1日の上限(rule)に加え、公開デモ用テナントでは
 * 1回のログイン(セッション)につき DEMO_AI_USES_PER_SESSION 回まで(先にこちらを数え、超えていればスタッフの枠は使わない)。
 */
export async function enforceAiQuota(
  c: Context<SessionEnv>,
  container: Container,
  rule: RateLimitRule,
  message: string,
): Promise<Response | null> {
  const session = c.get('session');
  if (container.demo && (await container.demo.isDemoTenant(session.tenantId))) {
    const decision = await consumeQuota(container, DEMO_AI_SESSION_RULE, session.sessionId, {
      tenantId: session.tenantId,
      actorStaffId: session.staffId,
      meta: requestMeta(c),
    });
    if (!decision.allowed) return rateLimited(c, decision.retryAfterMs, DEMO_AI_QUOTA_MESSAGE);
  }
  return enforceStaffQuota(c, container, rule, message);
}
