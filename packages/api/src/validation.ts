import type { Context } from 'hono';
import type { z } from 'zod';

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

function validationFailed(c: Context, error: z.ZodError): Response {
  const fields = Object.fromEntries(
    error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]),
  );
  return c.json({ code: 'validation_failed', message: '入力内容に誤りがあります', fields }, 400);
}

/** クエリパラメータを zod スキーマ(packages/shared の契約)で検証する。 */
export function parseQuery<S extends z.ZodTypeAny>(c: Context, schema: S): Parsed<z.infer<S>> {
  const result = schema.safeParse(c.req.query());
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: validationFailed(c, result.error) };
}

/** JSONボディを zod スキーマ(packages/shared の契約)で検証する。 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(body ?? {});
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, response: validationFailed(c, result.error) };
}
