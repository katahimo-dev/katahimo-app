import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookNotifierPort } from './webhookNotifierPort';

const VALID = 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t';
const resolverOf = (url: string | undefined) => ({ resolve: async () => url });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Google Chat Webhook 通知', () => {
  it('Google Chat の URL にリダイレクトを追わず・タイムアウト付きで送る', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new WebhookNotifierPort(resolverOf(VALID)).notify('t1', 'report', 'こんにちは');
    expect(result).toEqual({ status: 'sent' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('Google Chat 以外の URL には送らない(SSRF対策)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await new WebhookNotifierPort(
      resolverOf('http://169.254.169.254/computeMetadata/v1/'),
    ).notify('t1', 'report', 'x');
    expect(result).toEqual({ status: 'failed', error: 'invalid_webhook_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('失敗時は応答本文を結果に含めず、HTTPステータスだけを返す(リダイレクトも失敗扱い)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('secret echo', { status: 302 })),
    );
    const result = await new WebhookNotifierPort(resolverOf(VALID)).notify('t1', 'receipt', 'x');
    expect(result).toEqual({ status: 'failed', httpStatus: 302, error: 'http_error' });
  });

  it('未設定なら not_configured', async () => {
    expect(await new WebhookNotifierPort(resolverOf(undefined)).notify('t1', 'report', 'x')).toEqual({
      status: 'not_configured',
    });
  });
});
