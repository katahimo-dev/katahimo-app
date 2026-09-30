import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiApiKeyVerifier, NoopAiApiKeyVerifier, verifyGeminiApiKey } from './listModels';

afterEach(() => {
  vi.unstubAllGlobals();
});

const listResponse = () =>
  new Response(
    JSON.stringify({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
      nextPageToken: 'next',
    }),
    { status: 200 },
  );

describe('verifyGeminiApiKey(保存の前の API キーの確認)', () => {
  it('ListModels を1ページだけ、キーをヘッダーに載せて時間の上限つきで呼び、generateContent のモデルを返す', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => listResponse());
    vi.stubGlobal('fetch', fetchMock);
    expect(await new GeminiApiKeyVerifier().verifyApiKey('AIza-key')).toEqual({
      ok: true,
      models: ['gemini-2.5-flash'],
    });
    // 次のページがあっても読みに行かない(1回の問い合わせで確かめる)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    expect(url).not.toContain('AIza-key');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('AIza-key');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 401, 403])('HTTP %i はキーを断られた(key_rejected)', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{}}', { status })),
    );
    expect(await verifyGeminiApiKey('bad')).toEqual({
      ok: false,
      reason: 'key_rejected',
      httpStatus: status,
    });
  });

  it('429 は回数の上限、5xx はつながらない扱い', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 })),
    );
    expect(await verifyGeminiApiKey('k')).toEqual({ ok: false, reason: 'rate_limited', httpStatus: 429 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    expect(await verifyGeminiApiKey('k')).toEqual({ ok: false, reason: 'unreachable', httpStatus: 503 });
  });

  it('時間切れは timeout、通信の失敗・応答の形の違いは unreachable(例外は投げない)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('timed out', 'TimeoutError');
      }),
    );
    expect(await verifyGeminiApiKey('k')).toEqual({ ok: false, reason: 'timeout' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await verifyGeminiApiKey('k')).toEqual({ ok: false, reason: 'unreachable' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    expect(await verifyGeminiApiKey('k')).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('Noop は問い合わせずに、日報のモデルがある使えるキーとして返す', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new NoopAiApiKeyVerifier().verifyApiKey()).toMatchObject({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
