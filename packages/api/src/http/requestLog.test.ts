import { DomainError } from '@katahimo/core/domain';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { onApiError, requestLogger } from './requestLog';

function appThrowing(error: unknown) {
  const app = new Hono();
  app.use('*', requestLogger());
  app.get('/boom', () => {
    throw error;
  });
  app.onError(onApiError);
  return app;
}

describe('onApiError', () => {
  it('DomainError は code に応じたステータスと日本語の message・fields', async () => {
    const res = await appThrowing(new DomainError('conflict', '重なっています', { date: 'x' })).request(
      '/boom',
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'conflict', message: '重なっています', fields: { date: 'x' } });
  });

  it('cause のある DomainError(外部サービスの失敗)は応答に一般的な文言だけを返し、元の例外の文はプロセスのログに出す', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = new DomainError('upstream_unavailable', '予定を取得できませんでした。', undefined, 'x');
    error.cause = new Error('Calendar API: Not Found taro@example.com');
    const res = await appThrowing(error).request('/boom');
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('taro@example.com');
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Not Found taro@example.com');
    log.mockRestore();
  });

  it('想定外の例外は 500 internal にし、内部の情報を応答に出さない(ログには残す)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await appThrowing(new Error('password=secret at db.ts:10')).request('/boom', {
      headers: { 'X-Cloud-Trace-Context': `${'a'.repeat(32)}/1;o=1` },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(res.headers.get('x-request-id')).toBe('a'.repeat(32));
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('password=secret');
    log.mockRestore();
  });
});
