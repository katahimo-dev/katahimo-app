import { randomUUID } from 'node:crypto';
import { isDomainError } from '@katahimo/core/domain';
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { apiError, DOMAIN_ERROR_STATUS } from './responses';

/** リクエストIDを置く Context の変数名。 */
const REQUEST_ID_VAR = 'requestId';

/** Cloud Logging の構造化ログ(1行の JSON)を標準出力に書く。 */
export function writeStructuredLog(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  if (entry.severity === 'ERROR') console.error(line);
  else console.log(line);
}

/** X-Cloud-Trace-Context(`TRACE_ID/SPAN_ID;o=1`)のトレースID。 */
function traceIdOf(c: Context): string | null {
  const header = c.req.header('x-cloud-trace-context');
  const trace = header?.split('/')[0];
  return trace && /^[0-9a-f]{32}$/i.test(trace) ? trace : null;
}

/** このリクエストのID(requestLogger が決める。アプリログ・エラーログに添える)。 */
export function requestIdOf(c: Context): string | null {
  return (c.get(REQUEST_ID_VAR) as string | undefined) ?? null;
}

/**
 * リクエストのログ(1リクエスト1行、構造化)。リクエストIDは Cloud Run のトレースID(X-Cloud-Trace-Context)が
 * あればそれ、無ければ採番し、応答の X-Request-Id に返す。GCP_PROJECT_ID があれば Cloud Logging のトレースに結び付ける。
 * パス以外(クエリ・本文)は個人情報を含みうるため記録しない。
 */
export function requestLogger(options: { projectId?: string | undefined } = {}): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    const trace = traceIdOf(c);
    const requestId = trace ?? randomUUID();
    c.set(REQUEST_ID_VAR, requestId);
    c.header('X-Request-Id', requestId);
    await next();
    const status = c.res.status;
    writeStructuredLog({
      severity: status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO',
      message: `${c.req.method} ${c.req.path} ${status}`,
      httpRequest: {
        requestMethod: c.req.method,
        requestUrl: c.req.path,
        status,
        latency: `${((performance.now() - started) / 1000).toFixed(3)}s`,
        userAgent: c.req.header('user-agent')?.slice(0, 200),
      },
      requestId,
      ...(trace && options.projectId
        ? { 'logging.googleapis.com/trace': `projects/${options.projectId}/traces/${trace}` }
        : {}),
    });
  };
}

/**
 * 全ルート共通のエラー処理。DomainError は code に応じた応答(画面に出してよい日本語)、想定外の例外は
 * 詳細をログにだけ残して 500 internal(応答に内部の情報を出さない)。
 */
export const onApiError: ErrorHandler = (error, c) => {
  if (isDomainError(error)) {
    if (error.cause !== undefined) {
      // 外部サービスの失敗を一般的な文言の DomainError にしたもの: 元の例外の文はここ(プロセスのログ)にだけ出す
      // (操作ログには例外の種類・理由コードだけ。core/domain/errors/errorLogDetails.ts)
      const cause = error.cause;
      writeStructuredLog({
        severity: 'WARNING',
        message: '外部サービスの失敗を利用者に一般的な文言で返しました',
        requestId: requestIdOf(c),
        method: c.req.method,
        path: c.req.path,
        code: error.code,
        reason: error.reason,
        cause: cause instanceof Error ? { name: cause.name, message: cause.message } : String(cause),
      });
    }
    return apiError(c, DOMAIN_ERROR_STATUS[error.code], error.code, error.message, error.fields);
  }
  if (error instanceof HTTPException) {
    return error.status >= 500
      ? apiError(
          c,
          500,
          'internal',
          'サーバーでエラーが発生しました。しばらくしてから、もう一度お試しください。',
        )
      : error.getResponse();
  }
  writeStructuredLog({
    severity: 'ERROR',
    message: '処理中に想定外のエラーが発生しました',
    requestId: requestIdOf(c),
    method: c.req.method,
    path: c.req.path,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
  });
  return apiError(
    c,
    500,
    'internal',
    'サーバーでエラーが発生しました。しばらくしてから、もう一度お試しください。',
  );
};
