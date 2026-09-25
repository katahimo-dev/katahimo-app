import { getConnInfo } from '@hono/node-server/conninfo';
import type { RequestMeta } from '@katahimo/core/usecases';
import type { Context } from 'hono';

/**
 * アプリログに添える送信元情報。Cloud Run等のプロキシ配下ではX-Forwarded-Forの先頭が実際の
 * 送信元になる。取得できない場合(テストのapp.request等)はnull。
 */
export function requestMeta(c: Context): RequestMeta {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  let ip: string | null = forwarded || null;
  if (!ip) {
    try {
      ip = getConnInfo(c).remote.address ?? null;
    } catch {
      ip = null;
    }
  }
  return { ip, userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null };
}
