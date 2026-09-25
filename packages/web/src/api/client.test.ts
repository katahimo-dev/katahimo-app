import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, api, formatRetryAfter, NetworkError, userMessageOf } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers })),
  );

describe('api client', () => {
  it('理由つきの失敗は ApiRequestError。回数の上限は「あと約N分」を添える', async () => {
    stubFetch(
      429,
      { code: 'rate_limited', message: 'しばらく待ってから再度お試しください。' },
      { 'Retry-After': '900' },
    );
    const error = await api.get('/api/x', z.object({})).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).retryAfterSeconds).toBe(900);
    expect(userMessageOf(error)).toBe('しばらく待ってから再度お試しください。（あと約15分）');
  });

  it('理由の無い失敗・契約と違う応答は NetworkError(通信失敗の文言)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(500, { code: 'internal', message: 'x' });
    await expect(api.get('/api/x', z.object({}))).rejects.toBeInstanceOf(NetworkError);
    stubFetch(200, { unexpected: true });
    await expect(api.get('/api/x', z.object({ ok: z.literal(true) }))).rejects.toBeInstanceOf(NetworkError);
  });

  it('formatRetryAfter', () => {
    expect(formatRetryAfter(30)).toBe('あと約1分');
    expect(formatRetryAfter(3600)).toBe('あと約60分');
    expect(formatRetryAfter(3 * 3600)).toBe('あと約3時間');
  });
});
