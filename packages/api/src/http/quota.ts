import type { RateLimitRule } from '@katahimo/core/domain';
import { rateLimitIpSubject } from '@katahimo/core/domain';
import { consumeQuota } from '@katahimo/core/usecases';
import type { Context } from 'hono';
import type { Container } from '../container';
import type { SessionEnv } from '../session';
import {
  DEMO_AI_DAILY_QUOTA_MESSAGE,
  DEMO_AI_IP_DAY_RULE,
  DEMO_AI_QUOTA_MESSAGE,
  DEMO_AI_SESSION_RULE,
  DEMO_AI_TENANT_DAY_RULE,
} from './demoRestrictions';
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
    const meta = requestMeta(c);
    const context = { tenantId: session.tenantId, actorStaffId: session.staffId, meta };
    // 狭い枠から数える(超えた回で広い枠を使わない)
    const bySession = await consumeQuota(container, DEMO_AI_SESSION_RULE, session.sessionId, context);
    if (!bySession.allowed) return rateLimited(c, bySession.retryAfterMs, DEMO_AI_QUOTA_MESSAGE);
    if (meta.ip) {
      // IPv6 は /64 ごとに数える(アドレスを替えながらの回避を防ぐ。ログには元のアドレスを残す)
      const byIp = await consumeQuota(container, DEMO_AI_IP_DAY_RULE, rateLimitIpSubject(meta.ip), context);
      if (!byIp.allowed) return rateLimited(c, byIp.retryAfterMs, DEMO_AI_DAILY_QUOTA_MESSAGE);
    }
    const byTenant = await consumeQuota(container, DEMO_AI_TENANT_DAY_RULE, session.tenantId, context);
    if (!byTenant.allowed) return rateLimited(c, byTenant.retryAfterMs, DEMO_AI_DAILY_QUOTA_MESSAGE);
  }
  return enforceStaffQuota(c, container, rule, message);
}
