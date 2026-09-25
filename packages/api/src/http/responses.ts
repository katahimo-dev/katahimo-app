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
