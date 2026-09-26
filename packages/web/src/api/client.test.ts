import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ApiRequestError,
  api,
  filenameFromDisposition,
  formatRetryAfter,
  NetworkError,
  userMessageOf,
} from './client';

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

  it('契約と違う応答は、食い違った場所をコンソールの文言に入れる', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(200, { attendance: { rowVersion: -1 } });
    await expect(
      api.get('/api/x', z.object({ attendance: z.object({ rowVersion: z.number().nonnegative() }) })),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/契約と一致しません: attendance\.rowVersion: /);
  });

  it('本文を読み終える前に取り消された読み込みは中断のまま投げ、契約の食い違いとして記録しない', async () => {
    // 応答の頭が届いた後に signal が中断されると、本文の読み込み(res.json())が AbortError になる
    // (TanStack Query が保存後の読み直しのために、読み込み中の前の分を取り消したとき)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"attendance":'));
            controller.signal.addEventListener('abort', () =>
              c.error(new DOMException('The operation was aborted.', 'AbortError')),
            );
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const pending = api.get('/api/x', z.object({ attendance: z.object({}) }), undefined, {
      signal: controller.signal,
    });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('formatRetryAfter', () => {
    expect(formatRetryAfter(30)).toBe('あと約1分');
    expect(formatRetryAfter(3600)).toBe('あと約60分');
    expect(formatRetryAfter(3 * 3600)).toBe('あと約3時間');
  });

  it('ダウンロード: 成功は中身と Content-Disposition の名前(filename* を優先)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('xlsx', {
            status: 200,
            headers: {
              'Content-Type': 'application/x-test',
              'Content-Disposition': `attachment; filename="a.xlsx"; filename*=UTF-8''${encodeURIComponent('出勤簿 9月.xlsx')}`,
            },
          }),
      ),
    );
    const file = await api.download(
      '/api/x',
      { month: '2026-09', staffId: undefined },
      'application/x-test',
      'b.xlsx',
    );
    expect(file.filename).toBe('出勤簿 9月.xlsx');
    expect(await file.blob.text()).toBe('xlsx');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/x?month=2026-09');
  });

  it('ダウンロード: 断られたら理由つきのエラー(ファイルにしない)、種類の違う応答は通信の失敗', async () => {
    stubFetch(429, { code: 'rate_limited', message: '上限です。' }, { 'Retry-After': '60' });
    const error = await api
      .download('/api/x', undefined, 'application/x-test', 'b.xlsx')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(userMessageOf(error)).toBe('上限です。（あと約1分）');
    stubFetch(200, { ok: true }, { 'Content-Type': 'application/json' });
    await expect(api.download('/api/x', undefined, 'application/x-test', 'b.xlsx')).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('filenameFromDisposition', () => {
    expect(filenameFromDisposition(null, 'x.xlsx')).toBe('x.xlsx');
    expect(filenameFromDisposition('attachment; filename="a.xlsx"', 'x.xlsx')).toBe('a.xlsx');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E5%87%BA.xlsx", 'x.xlsx')).toBe('出.xlsx');
    expect(
      filenameFromDisposition('attachment; filename="a.xlsx"; filename*=UTF-8\'\'%E0%A4', 'x.xlsx'),
    ).toBe('a.xlsx');
  });
});
