import type { ApiError } from '@katahimo/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** エラー応答の共通形(@katahimo/sharedのapiErrorSchema)。 */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiError['code'],
  message: string,
  fields?: Record<string, string>,
) {
  const body: ApiError = fields ? { code, message, fields } : { code, message };
  return c.json(body, status);
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/** JSONボディをzodスキーマで検証する。失敗時は400(validation_failed)の応答を返す。 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<ParsedBody<z.output<S>>> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const message = parsed.error.issues[0]?.message ?? '入力内容に誤りがあります';
  return { ok: false, response: apiError(c, 400, 'validation_failed', message, fields) };
}

/** クエリパラメータをzodスキーマで検証する。失敗時は400(validation_failed)の応答を返す。 */
export function parseQuery<S extends z.ZodTypeAny>(c: Context, schema: S): ParsedBody<z.output<S>> {
  const parsed = schema.safeParse(c.req.query());
  if (parsed.success) return { ok: true, data: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const message = parsed.error.issues[0]?.message ?? '入力内容に誤りがあります';
  return { ok: false, response: apiError(c, 400, 'validation_failed', message, fields) };
}

/** 回数制限を超えた要求への 429(rate_limited)。Retry-After に再試行までの秒数を付ける。 */
export function rateLimited(c: Context, retryAfterMs: number, message: string) {
  c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return apiError(c, 429, 'rate_limited', message);
}
