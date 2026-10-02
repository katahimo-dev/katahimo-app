import type { RateLimitRule } from '@katahimo/core/domain';
import { normalizeEmailForIndex } from '@katahimo/core/domain';
import type { TenantDirectoryPort, UnitOfWorkPort } from '@katahimo/core/ports';
import type { RateLimitPolicy } from '@katahimo/core/usecases';
import { decodeSessionCookie, SESSION_ABSOLUTE_TTL_MS } from '@katahimo/core/usecases';
import { DEMO_ACCOUNTS, DEMO_AI_USES_PER_SESSION } from '@katahimo/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { Container } from '../container';
import { readSessionCookie } from '../session';
import { requestMeta } from './requestMeta';
import { apiError } from './responses';

/**
 * 公開デモ(`DEMO_TENANT_SLUG` の1テナントを訪問者みんなで使う)の制限。
 *
 * データは毎晩作り直す(`pnpm demo:reset`)ので、入力・編集は普通に使えるようにし、断るのは
 * 「1人の操作で他の訪問者のデモを壊す」「外へ送る」ものだけにする:
 * - デモ用アカウント(`DEMO_ACCOUNTS`)のパスワードの変更・再設定、変更・削除(ログインできなくなる)
 * - スタッフの xlsx の取込・パスワード案内メール、顧客 CSV の取込(データを丸ごと入れ替える・メールを送る)
 * - Google Chat の通知先の保存(訪問者の入れた先へ外部送信が起きる)。Gemini の API キーは保存できる(デモでも実際に
 *   AI で書けるように。毎晩の作り直しでも引き継ぐ)
 * また、アカウント単位のログインのロックはしない(誰かがわざと間違え続けると全員がログインできなくなるため。
 * 送信元IP単位のロックは残す)。AI(日報・事故報告の生成、領収書の読み取り)は1回のログインで
 * `DEMO_AI_USES_PER_SESSION` 回まで。
 */
export const DEMO_REFUSED_MESSAGE = 'デモ環境ではこの操作はできません。';
export const DEMO_AI_QUOTA_MESSAGE = `デモ環境では、AIを使えるのは1回のログインにつき${DEMO_AI_USES_PER_SESSION}回までです。`;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * デモ用テナント全体・送信元IPごとの1日の AI の回数(ログインし直す・スタッフを足すことで1回のログインの上限を
 * 増やせても、Gemini の費用とほかの訪問者の枠に天井を掛ける)。
 */
export const DEMO_AI_TENANT_DAY_RULE: RateLimitRule = {
  name: 'demo_ai_tenant_day',
  limit: 300,
  windowMs: DAY_MS,
};
export const DEMO_AI_IP_DAY_RULE: RateLimitRule = { name: 'demo_ai_ip_day', limit: 30, windowMs: DAY_MS };
export const DEMO_AI_DAILY_QUOTA_MESSAGE =
  'デモ環境の本日のAIの利用回数の上限に達しました。明日以降に再度お試しください。';

/** デモ用テナントでのAIの回数(セッション単位。セッションの最長の有効期間を窓にする)。 */
export const DEMO_AI_SESSION_RULE: RateLimitRule = {
  name: 'demo_ai_session',
  limit: DEMO_AI_USES_PER_SESSION,
  windowMs: SESSION_ABSOLUTE_TTL_MS,
};

/** テナントの判定の仕方: ログイン中のセッションのテナント / 本文の tenantSlug(未ログインの API)。 */
type TenantSource = 'session' | 'body_slug';

export interface DemoRestrictionRule {
  /** ログ(`demo.action_refused`)に残す名前。 */
  name: string;
  method: string;
  path: RegExp;
  tenant: TenantSource;
  /** パスの :id がデモ用アカウントのときだけ断る(それ以外のスタッフは編集してよい)。 */
  demoAccountTargetOnly?: boolean;
}

const STAFF_ID = '([^/]+)';

/** 断る操作の一覧(ここにないものはデモでも使える)。 */
export const DEMO_RESTRICTION_RULES: readonly DemoRestrictionRule[] = [
  { name: 'auth.password_change', method: 'POST', path: /^\/api\/auth\/change-password$/, tenant: 'session' },
  {
    name: 'auth.password_reset_request',
    method: 'POST',
    path: /^\/api\/auth\/password-reset\/request$/,
    tenant: 'body_slug',
  },
  {
    name: 'auth.password_reset_confirm',
    method: 'POST',
    path: /^\/api\/auth\/password-reset\/confirm$/,
    tenant: 'body_slug',
  },
  { name: 'staff.xlsx_import', method: 'POST', path: /^\/api\/admin\/staff\/import$/, tenant: 'session' },
  {
    name: 'staff.admin.password_guide',
    method: 'POST',
    path: new RegExp(`^/api/admin/staff/${STAFF_ID}/password-guide$`),
    tenant: 'session',
  },
  {
    name: 'staff.admin.update',
    method: 'PATCH',
    path: new RegExp(`^/api/admin/staff/${STAFF_ID}$`),
    tenant: 'session',
    demoAccountTargetOnly: true,
  },
  {
    name: 'staff.admin.delete',
    method: 'DELETE',
    path: new RegExp(`^/api/admin/staff/${STAFF_ID}$`),
    tenant: 'session',
    demoAccountTargetOnly: true,
  },
  {
    name: 'customer_csv.import',
    method: 'POST',
    path: /^\/api\/admin\/customers\/import$/,
    tenant: 'session',
  },
  // 操作ログには他の訪問者の送信元IP・ブラウザが残るため、共有の管理者アカウントには見せない
  { name: 'audit_log.view', method: 'GET', path: /^\/api\/admin\/audit-logs$/, tenant: 'session' },
  { name: 'audit_log.export', method: 'GET', path: /^\/api\/admin\/audit-logs\.csv$/, tenant: 'session' },
  // Gemini の API キーの保存は断らない(運用担当者がデモでも実際に AI で書けるようにするため。回数は enforceAiQuota で
  // 絞り、キーは demo:reset が引き継ぐ。GET は伏せ字しか返さないので、訪問者に保存済みのキーは見えない)
  {
    name: 'settings.gchat_webhooks.save',
    method: 'POST',
    path: /^\/api\/settings\/admin\/gchat-webhooks$/,
    tenant: 'session',
  },
];

/** メソッド・パスに当たる規則と、パスの :id(あれば)。 */
export function matchDemoRestriction(
  method: string,
  path: string,
): { rule: DemoRestrictionRule; targetId: string | null } | null {
  for (const rule of DEMO_RESTRICTION_RULES) {
    if (rule.method !== method.toUpperCase()) continue;
    const m = rule.path.exec(path);
    if (m) return { rule, targetId: m[1] ?? null };
  }
  return null;
}

/**
 * デモ用テナントの判定。slug は環境変数、テナントの ID は毎晩の作り直しで変わるため、ID → デモかどうかを
 * プロセス内に覚えておく(ID は作り直しのたびに新しくなるので、覚えた結果が古くなることはない)。
 */
export class DemoTenant {
  private readonly known = new Map<string, boolean>();

  constructor(
    readonly slug: string,
    private readonly tenants: TenantDirectoryPort,
  ) {}

  isDemoSlug(slug: unknown): boolean {
    return typeof slug === 'string' && slug.trim().toLowerCase() === this.slug;
  }

  async isDemoTenant(tenantId: string): Promise<boolean> {
    const cached = this.known.get(tenantId);
    if (cached !== undefined) return cached;
    const tenant = await this.tenants.findById(tenantId);
    // 見つからない ID(作り直しで消えたテナントの古い Cookie 等)は覚えない
    if (!tenant) return false;
    const result = tenant.slug === this.slug;
    if (this.known.size >= 1000) this.known.clear();
    this.known.set(tenantId, result);
    return result;
  }

  /** デモ用テナントでは、アカウント単位のログインの失敗は数えるだけでロックしない(送信元IP単位は残す)。 */
  loginRateLimits(policy: RateLimitPolicy): RateLimitPolicy {
    return {
      ...policy,
      loginFailureAccount: {
        name: policy.loginFailureAccount.name,
        limit: Number.MAX_SAFE_INTEGER,
        windowMs: policy.loginFailureAccount.windowMs,
      },
    };
  }
}

/** Cookie から読んだテナント(認証はしない。断るかどうかの判定だけに使う)。 */
function sessionTenantIdOf(c: Context, container: Container): string | null {
  const cookie = readSessionCookie(c, container);
  return cookie ? (decodeSessionCookie(cookie)?.tenantId ?? null) : null;
}

async function bodyTenantSlugOf(c: Context): Promise<unknown> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === 'object' ? (body as { tenantSlug?: unknown }).tenantSlug : undefined;
  } catch {
    // 本文の形の誤りは各ルートの検証(400)に任せる
    return undefined;
  }
}

async function isDemoAccount(uow: UnitOfWorkPort, tenantId: string, staffId: string): Promise<boolean> {
  const ids = await uow.run(tenantId, (r) =>
    Promise.all(DEMO_ACCOUNTS.map((a) => r.staff.findByLoginEmail(normalizeEmailForIndex(a.email)))),
  );
  // パスの ID は大文字でも DB では同じスタッフを指すため、小文字にそろえて比べる
  const target = staffId.toLowerCase();
  return ids.some((staff) => staff?.id.toLowerCase() === target);
}

/**
 * デモ用テナントの断る操作を 403 にするミドルウェア(`/api/*`、各ルートの前)。`DEMO_TENANT_SLUG` が無ければ何もしない。
 * テナントは Cookie の先頭(テナント ID)か本文の tenantSlug で決める。Cookie は認証しないが、他のテナントのふりをしても
 * 断られる側に倒れるだけ(デモ用テナントのセッションは必ずデモ用テナントの ID を持つ)。
 */
export function demoRestrictions(container: Container): MiddlewareHandler {
  return async (c, next) => {
    const demo = container.demo;
    if (!demo) return next();
    const matched = matchDemoRestriction(c.req.method, c.req.path);
    if (!matched) return next();
    const { rule, targetId } = matched;

    let tenantId: string | null = null;
    if (rule.tenant === 'session') {
      tenantId = sessionTenantIdOf(c, container);
      if (!tenantId || !(await demo.isDemoTenant(tenantId))) return next();
    } else if (!demo.isDemoSlug(await bodyTenantSlugOf(c))) {
      return next();
    }
    if (rule.demoAccountTargetOnly) {
      if (!tenantId || !targetId || !(await isDemoAccount(container.uow, tenantId, targetId))) return next();
    }

    await container.appLog.write({
      tenantId,
      level: 'WARN',
      action: 'demo.action_refused',
      details: { rule: rule.name },
      ...requestMeta(c),
    });
    return apiError(c, 403, 'forbidden', DEMO_REFUSED_MESSAGE);
  };
}
