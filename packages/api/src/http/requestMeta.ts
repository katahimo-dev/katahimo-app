import { getConnInfo } from '@hono/node-server/conninfo';
import type { RequestMeta } from '@katahimo/core/usecases';
import type { Context, MiddlewareHandler } from 'hono';

/** clientIpMiddleware が Context に置く送信元IPの変数名。 */
const CLIENT_IP_VAR = 'clientIp';

/**
 * X-Forwarded-For から送信元IPを選ぶ。プロキシは受け取った値の末尾に接続元を付け足すため、利用者が
 * 送ってきた値(偽装できる)は左側に、信頼できるプロキシが付けた値は右側に並ぶ。右から trustedHops 番目
 * (Cloud Run 直: 1 = Google Front End が付けた値)を採用し、先頭(左端)は使わない。
 * 段数が足りない・0 の場合は null(接続元のアドレスを使う)。
 */
export function clientIpFromForwardedFor(header: string | undefined, trustedHops: number): string | null {
  if (!header || trustedHops <= 0) return null;
  const entries = header
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  return entries[entries.length - trustedHops] ?? null;
}

function socketAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    // テストの app.request 等、Node の接続情報が無い場合
    return null;
  }
}

/** 送信元IPを1回だけ判定して Context に置く(requestMeta・レート制限が使う)。app の最初に登録する。 */
export function clientIpMiddleware(trustedHops: number): MiddlewareHandler {
  return async (c, next) => {
    c.set(
      CLIENT_IP_VAR,
      clientIpFromForwardedFor(c.req.header('x-forwarded-for'), trustedHops) ?? socketAddress(c),
    );
    await next();
  };
}

/** clientIpMiddleware が判定した送信元IP(未登録なら接続元のアドレス)。 */
export function clientIp(c: Context): string | null {
  const value = c.get(CLIENT_IP_VAR) as string | null | undefined;
  return value === undefined ? socketAddress(c) : value;
}

/** アプリログに添える送信元情報。 */
export function requestMeta(c: Context): RequestMeta {
  return { ip: clientIp(c), userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null };
}
