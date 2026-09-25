import { createHash, randomBytes } from 'node:crypto';

/**
 * セッションCookieの値は `tenantId.rawToken` の形にする。
 *
 * sessions テーブルはRLS対象(tenant_idで分離)なので、findByTokenHashを呼ぶには先に
 * tenantIdが分かっている必要がある。ログイン後のリクエストではCookieしか手がかりが無いため、
 * Cookie自体にtenantIdを埋め込んでおく。tenantIdだけ分かっても、対応する生トークンを
 * 知らなければセッションを乗っ取れないため、これを平文で保持しても安全。
 */
const SESSION_COOKIE_SEPARATOR = '.';

export function issueSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** セッショントークン(生の値)からDB保存用のハッシュを計算する。DBダンプが漏れてもCookieに使える値を得られないようにするため。 */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function encodeSessionCookie(tenantId: string, rawToken: string): string {
  return `${tenantId}${SESSION_COOKIE_SEPARATOR}${rawToken}`;
}

export function decodeSessionCookie(cookieValue: string): { tenantId: string; rawToken: string } | null {
  const idx = cookieValue.indexOf(SESSION_COOKIE_SEPARATOR);
  if (idx <= 0 || idx === cookieValue.length - 1) return null;
  return { tenantId: cookieValue.slice(0, idx), rawToken: cookieValue.slice(idx + 1) };
}
