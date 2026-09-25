import { createHash, randomBytes } from 'node:crypto';

/**
 * セッション Cookie の値は `tenantId.rawToken`。sessions は RLS の対象のため、Cookie だけからトークンを
 * 探すにはテナントが先に分かっている必要がある。テナントIDが分かっても生トークンを知らなければ
 * セッションを使えないため、平文で持ってよい。
 */
const SEPARATOR = '.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function issueSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** DB に保存するのは生トークンの SHA-256 だけ(DBダンプが漏れても Cookie に使える値を得られない)。 */
export function hashSessionToken(rawToken: string): Uint8Array {
  return createHash('sha256').update(rawToken, 'utf8').digest();
}

export function encodeSessionCookie(tenantId: string, rawToken: string): string {
  return `${tenantId}${SEPARATOR}${rawToken}`;
}

/** 形式の不正な Cookie(テナントIDが UUID でない等)は null。 */
export function decodeSessionCookie(cookieValue: string): { tenantId: string; rawToken: string } | null {
  const idx = cookieValue.indexOf(SEPARATOR);
  if (idx <= 0 || idx === cookieValue.length - 1) return null;
  const tenantId = cookieValue.slice(0, idx);
  const rawToken = cookieValue.slice(idx + 1);
  if (!UUID_PATTERN.test(tenantId) || !/^[0-9a-f]{64}$/.test(rawToken)) return null;
  return { tenantId, rawToken };
}
