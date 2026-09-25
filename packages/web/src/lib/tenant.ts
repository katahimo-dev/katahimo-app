import { getBrowserStorage, type KeyValueStorage, readStorage, STORAGE_KEYS, writeStorage } from './storage';

/**
 * ログインに使う法人ID(tenantSlug)の決め方。
 *
 * GAS版は1法人専用だったためログイン画面に法人を選ぶ欄が無い。見た目をGAS版と揃えるため、
 * 次の順に法人IDを決め、どれでも決まらなかったときだけログイン画面に「法人ID」欄を出す。
 *
 * 1. ビルド時の既定値 `VITE_DEFAULT_TENANT_SLUG`(1法人向けの本番ビルド)
 * 2. URL — クエリ `?t=<法人ID>`、または `VITE_TENANT_BASE_DOMAIN` を設定している場合のサブドメイン
 *    (`<法人ID>.<ベースドメイン>`)
 * 3. このブラウザで最後にログインできた法人ID(localStorage)
 */
export type TenantSource = 'env' | 'query' | 'subdomain' | 'storage';

export interface ResolvedTenant {
  slug: string;
  source: TenantSource;
}

export interface TenantResolveInput {
  envDefault?: string | undefined;
  /** location.search(先頭の ? はあってもなくてもよい) */
  search?: string | undefined;
  hostname?: string | undefined;
  baseDomain?: string | undefined;
  storedSlug?: string | null | undefined;
}

/** 法人IDとして受け付ける形(英小文字・数字・ハイフン)。URLに紛れた余計な値を拾わないため。 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeTenantSlug(value: string | null | undefined): string | null {
  const slug = (value ?? '').trim().toLowerCase();
  return SLUG_PATTERN.test(slug) ? slug : null;
}

export function tenantSlugFromSubdomain(
  hostname: string | undefined,
  baseDomain: string | undefined,
): string | null {
  const host = (hostname ?? '').toLowerCase();
  const base = (baseDomain ?? '').trim().toLowerCase().replace(/^\./, '');
  if (!host || !base || !host.endsWith(`.${base}`)) return null;
  const sub = host.slice(0, -(base.length + 1));
  // 「a.b.<base>」のような多段は法人IDとみなさない。www も除く。
  if (sub.includes('.') || sub === 'www') return null;
  return normalizeTenantSlug(sub);
}

export function resolveTenant(input: TenantResolveInput): ResolvedTenant | null {
  const fromEnv = normalizeTenantSlug(input.envDefault);
  if (fromEnv) return { slug: fromEnv, source: 'env' };

  const fromQuery = normalizeTenantSlug(new URLSearchParams(input.search ?? '').get('t'));
  if (fromQuery) return { slug: fromQuery, source: 'query' };

  const fromSubdomain = tenantSlugFromSubdomain(input.hostname, input.baseDomain);
  if (fromSubdomain) return { slug: fromSubdomain, source: 'subdomain' };

  const fromStorage = normalizeTenantSlug(input.storedSlug);
  if (fromStorage) return { slug: fromStorage, source: 'storage' };

  return null;
}

/** ブラウザの実際の環境から法人IDを決める。 */
export function resolveTenantFromBrowser(storage: KeyValueStorage | null = getBrowserStorage()) {
  return resolveTenant({
    envDefault: import.meta.env.VITE_DEFAULT_TENANT_SLUG,
    search: window.location.search,
    hostname: window.location.hostname,
    baseDomain: import.meta.env.VITE_TENANT_BASE_DOMAIN,
    storedSlug: readStorage(STORAGE_KEYS.lastTenantSlug, storage),
  });
}

/** ログインできた法人IDを覚えておく(次回から「法人ID」欄を出さないため)。 */
export function rememberTenantSlug(slug: string, storage: KeyValueStorage | null = getBrowserStorage()) {
  const normalized = normalizeTenantSlug(slug);
  if (normalized) writeStorage(STORAGE_KEYS.lastTenantSlug, normalized, storage);
}
