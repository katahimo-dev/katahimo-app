import { createHash, randomBytes } from 'node:crypto';
import { invalid, newId, notFound, rateLimitIpSubject } from '../domain';
import { CUSTOMER_SOURCES, type CustomerSource } from '../domain/model';
import type { AppLogPort } from '../ports/appLog';
import type { IntegrationApiKeyRecord } from '../ports/integrations';
import type { RateLimiterPort } from '../ports/rateLimiter';
import type { TenantDirectoryPort, TenantRecord } from '../ports/tenants';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { RateLimitPolicy } from './rateLimits';
import type { Clock, RequestMeta } from './requestMeta';
import { currentTime } from './requestMeta';

// ─────────────────────────────────────────────────────────────
// トークン(`kth_<テナントID(ハイフンなし32桁)>_<乱数 32バイト base64url>`)
// ─────────────────────────────────────────────────────────────

/**
 * integration_api_keys は RLS の対象のため、トークンだけから行を探すにはテナントが先に分かっている必要がある
 * (セッション Cookie の `tenantId.rawToken` と同じ考え方)。テナントIDが分かっても乱数の部分を知らなければ
 * 使えないため、平文で持ってよい。先頭の `kth_` は漏れたトークンを見つけやすくするための目印
 * (シークレットのスキャン・ログの確認)。
 */
const TOKEN_PATTERN = /^kth_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

/** DB に保存するのはトークン全体の SHA-256 だけ。 */
export function hashIntegrationApiToken(token: string): Uint8Array {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function issueIntegrationApiToken(tenantId: string): string {
  return `kth_${tenantId.replaceAll('-', '').toLowerCase()}_${randomBytes(32).toString('base64url')}`;
}

/** 形式の正しいトークンなら、そのテナントID(ハイフンつきの UUID)。 */
export function tenantIdOfIntegrationApiToken(token: string): string | null {
  const hex = TOKEN_PATTERN.exec(token)?.[1];
  if (!hex) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─────────────────────────────────────────────────────────────
// 運用担当者の CLI(`pnpm tenant:api-keys`。所有者の接続の UoW で書く)
// ─────────────────────────────────────────────────────────────

export interface IntegrationApiKeyAdminDeps extends Clock {
  tenants: TenantDirectoryPort;
  /** 所有者の接続(MIGRATION_DATABASE_URL)の UoW。アプリのロールはキーを作れない。 */
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

async function tenantOf(deps: IntegrationApiKeyAdminDeps, slug: string): Promise<TenantRecord> {
  const tenant = await deps.tenants.findBySlug(slug.trim().toLowerCase());
  if (!tenant) throw invalid(`テナントが見つかりません: ${slug}`, undefined, 'tenant_not_found');
  return tenant;
}

export function listIntegrationApiKeys(
  deps: IntegrationApiKeyAdminDeps,
  tenantSlug: string,
): Promise<IntegrationApiKeyRecord[]> {
  return tenantOf(deps, tenantSlug).then((tenant) =>
    deps.uow.run(tenant.id, (r) => r.integrationApiKeys.list()),
  );
}

export interface CreateIntegrationApiKeyInput {
  name: string;
  /** このキーで書ける顧客の取込元。RESERVA からの連携は reserva(顧客CSVと同じ顧客IDの顧客を更新する)。 */
  customerSource: string;
  /** 発行した運用担当者。 */
  createdBy: string;
}

/**
 * API キーを発行する。トークンは戻り値でだけ返す(DB には SHA-256 だけを残す。もう一度表示する手段は無い)。
 * SECURITY `tenant.api_key.created` を残す(トークン・ハッシュは残さない)。
 */
export async function createIntegrationApiKey(
  deps: IntegrationApiKeyAdminDeps,
  tenantSlug: string,
  input: CreateIntegrationApiKeyInput,
): Promise<{ key: IntegrationApiKeyRecord; token: string }> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) {
    throw invalid('キーの名前は1〜100文字にしてください', undefined, 'invalid_name');
  }
  if (!(CUSTOMER_SOURCES as readonly string[]).includes(input.customerSource)) {
    throw invalid(
      `取込元は ${CUSTOMER_SOURCES.join(' / ')} のどれかにしてください: ${input.customerSource}`,
      undefined,
      'invalid_source',
    );
  }
  const tenant = await tenantOf(deps, tenantSlug);
  const token = issueIntegrationApiToken(tenant.id);
  const key = await deps.uow.run(tenant.id, (r) =>
    r.integrationApiKeys.create({
      id: newId(),
      name,
      customerSource: input.customerSource as CustomerSource,
      tokenHash: hashIntegrationApiToken(token),
      createdBy: input.createdBy,
    }),
  );
  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'SECURITY',
    action: 'tenant.api_key.created',
    actorType: 'operator',
    details: {
      apiKeyId: key.id,
      name: key.name,
      customerSource: key.customerSource,
      createdBy: key.createdBy,
    },
  });
  return { key, token };
}

/** API キーを失効させる(以後の要求は 401)。SECURITY `tenant.api_key.revoked`。 */
export async function revokeIntegrationApiKey(
  deps: IntegrationApiKeyAdminDeps,
  tenantSlug: string,
  apiKeyId: string,
): Promise<IntegrationApiKeyRecord> {
  const tenant = await tenantOf(deps, tenantSlug);
  const now = currentTime(deps);
  const result = await deps.uow.run(tenant.id, async (r) => {
    const key = (await r.integrationApiKeys.list()).find((k) => k.id === apiKeyId);
    if (!key) return null;
    const revoked = await r.integrationApiKeys.revoke(key.id, now);
    return { key: revoked ? { ...key, revokedAt: now } : key, revoked };
  });
  if (!result) throw notFound(`API キーが見つかりません: ${apiKeyId}`);
  if (result.revoked) {
    await deps.appLog.write({
      tenantId: tenant.id,
      level: 'SECURITY',
      action: 'tenant.api_key.revoked',
      actorType: 'operator',
      details: { apiKeyId: result.key.id, name: result.key.name },
    });
  }
  return result.key;
}

// ─────────────────────────────────────────────────────────────
// API の認証(`Authorization: Bearer <token>`)
// ─────────────────────────────────────────────────────────────

/** 認証できた API キー(以後の処理のテナント・取込元はこれだけで決める)。 */
export interface AuthenticatedIntegrationKey {
  tenantId: string;
  apiKeyId: string;
  name: string;
  customerSource: CustomerSource;
}

export type IntegrationAuthFailureReason =
  | 'missing'
  | 'malformed'
  | 'unknown_key'
  | 'revoked'
  | 'tenant_suspended';

export type IntegrationAuthResult =
  | { ok: true; key: AuthenticatedIntegrationKey }
  | { ok: false; reason: IntegrationAuthFailureReason; tenantId: string | null }
  /** 送信元IPの認証の失敗が続いたため一時的に断っている(認証はしていない)。 */
  | { ok: false; reason: 'locked'; tenantId: null; retryAfterMs: number };

export interface IntegrationAuthDeps extends Clock {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
  rateLimiter: RateLimiterPort;
  rateLimits: Pick<RateLimitPolicy, 'integrationAuthFailureIp'>;
}

/**
 * API キーを確かめる(1回の短いトランザクション)。トークンのテナントの部分で RLS のテナントを決め、トークン全体の
 * SHA-256 で行を探す(平文を比べないため、比べる時間からトークンを推し量れない)。見つかれば last_used_at を更新する。
 * 失敗は WARN `integration.auth_failed`(トークンは残さない。テナントはキーが見つかった時だけ記録する)。
 * 送信元IPごとに失敗を数え(integration_auth_failure_ip。ログインの login_failure_ip と同じく確かめる前に1回分を取り、
 * 成功なら返す)、上限に達したら一時ロックする。ロック中の要求は DB での確認も操作ログも行わずに locked を返す
 * (API は 429)。ロックの始まりに1回だけ WARN `integration.auth_locked` を残す。
 */
export async function authenticateIntegrationApiKey(
  deps: IntegrationAuthDeps,
  token: string | null,
  meta: RequestMeta = {},
): Promise<IntegrationAuthResult> {
  const now = currentTime(deps);
  // IPv6 は /64 ごとに数える(rateLimitIpSubject。ログには元のアドレスを残す)
  const ip = meta.ip ? rateLimitIpSubject(meta.ip) : null;
  const rule = deps.rateLimits.integrationAuthFailureIp;
  // 先に1回分の枠を取る(同時に送られた多数の誤ったキーでも、確かめるのは上限の回数まで)
  const byIp = ip ? await deps.rateLimiter.consume(rule, ip, now) : null;
  if (byIp && !byIp.allowed) {
    return { ok: false, reason: 'locked', tenantId: null, retryAfterMs: byIp.retryAfterMs };
  }
  const tenantId = token ? tenantIdOfIntegrationApiToken(token) : null;
  const result: IntegrationAuthResult =
    !token || !tenantId
      ? { ok: false, reason: token ? 'malformed' : 'missing', tenantId: null }
      : await deps.uow.run(tenantId, async (r) => {
          const key = await r.integrationApiKeys.findByTokenHash(hashIntegrationApiToken(token));
          // トークンのテナントの部分は書き換えられうるため、キーが見つかるまではテナント不明として記録する
          if (!key) return { ok: false as const, reason: 'unknown_key' as const, tenantId: null };
          if (key.revokedAt) return { ok: false as const, reason: 'revoked' as const, tenantId };
          if ((await r.tenant()).status !== 'active') {
            return { ok: false as const, reason: 'tenant_suspended' as const, tenantId };
          }
          await r.integrationApiKeys.touch(key.id, now);
          return {
            ok: true as const,
            key: { tenantId, apiKeyId: key.id, name: key.name, customerSource: key.customerSource },
          };
        });
  if (result.ok) {
    // 成功した回は数えない(先に取った1回分を返す)
    if (ip) await deps.rateLimiter.refund(rule, ip);
    return result;
  }
  await deps.appLog.write({
    tenantId: result.tenantId,
    level: 'WARN',
    action: 'integration.auth_failed',
    actorType: 'anonymous',
    details: { reason: result.reason },
    ...meta,
  });
  if (byIp?.lockStarted) {
    await deps.appLog.write({
      tenantId: result.tenantId,
      level: 'WARN',
      action: 'integration.auth_locked',
      actorType: 'anonymous',
      details: { rule: rule.name, limit: rule.limit, lockMs: rule.lockMs ?? null },
      ...meta,
    });
  }
  return result;
}
