import type { DomainErrorCode } from '@katahimo/core/domain';
import type { ApiError } from '@katahimo/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** エラー応答の共通形(@katahimo/shared の apiErrorSchema)。 */
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

/** DomainError の code → HTTP ステータス(変換はここだけ。app.onError が使う)。 */
export const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  forbidden: 403,
  validation_failed: 400,
  // 月の締め・当月以外の修正。GAS版と同じく入力の誤りと同じ扱いにする(再試行しても通らない)
  locked: 400,
  conflict: 409,
  rate_limited: 429,
  upstream_unavailable: 502,
};

/** JSON にしたときに同じ形になる値(Date は ISO8601 の文字列になる)。 */
export type JsonInput<T> = T extends string
  ? string | Date
  : T extends readonly (infer U)[]
    ? readonly JsonInput<U>[]
    : T extends object
      ? { [K in keyof T]: JsonInput<T[K]> }
      : T;

/**
 * 成功の応答。JSON にした値を応答の形(@katahimo/shared のスキーマ)で検証してから返す(サーバー側の
 * 食い違いを画面ではなくここで気づけるようにする。スキーマに無い項目は落ちる)。
 */
export function jsonOk<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
  body: JsonInput<z.input<S>>,
  status: ContentfulStatusCode = 200,
) {
  return c.json(schema.parse(JSON.parse(JSON.stringify(body))) as object, status);
}

/** 検証エラーの応答(400 validation_failed)。項目ごとの最初のメッセージを fields にする。 */
function validationFailed(c: Context, error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const message = error.issues[0]?.message ?? '入力内容に誤りがあります';
  return apiError(c, 400, 'validation_failed', message, fields);
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** JSON ボディを zod スキーマで検証する。失敗時は 400(validation_failed)の応答を返す。 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<Parsed<z.output<S>>> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, response: validationFailed(c, parsed.error) };
}

/** クエリパラメータを zod スキーマで検証する。失敗時は 400(validation_failed)の応答を返す。 */
export function parseQuery<S extends z.ZodTypeAny>(c: Context, schema: S): Parsed<z.output<S>> {
  const parsed = schema.safeParse(c.req.query());
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, response: validationFailed(c, parsed.error) };
}

/** 回数制限を超えた要求への 429(rate_limited)。Retry-After に再試行までの秒数を付ける。 */
export function rateLimited(c: Context, retryAfterMs: number, message: string) {
  c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return apiError(c, 429, 'rate_limited', message);
}
