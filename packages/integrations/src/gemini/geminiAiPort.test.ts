import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAiPort } from './geminiAiPort';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeminiAiPort(日報のモデルの切り替え)', () => {
  it('指定したモデルで呼び、応答が遅くて打ち切ったら次のモデルで試せる失敗にする', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('timed out', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetchMock);
    const port = new GeminiAiPort({ apiKey: 'key-timeout' });
    const draft = await port.generateDailyReport({ prompt: 'p', model: 'gemini-2.0-flash' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/models/gemini-2.0-flash:generateContent');
    expect(draft).toMatchObject({ warnings: ['API Error'], retryable: true });
    expect(draft.internal).toContain('打ち切りました');
  });

  it('API キーの誤りは切り替えても同じなので、試し直さない失敗にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"status":"API_KEY_INVALID"}}', { status: 400 })),
    );
    const draft = await new GeminiAiPort({ apiKey: 'key-invalid' }).generateDailyReport({ prompt: 'p' });
    expect(draft).toMatchObject({ warnings: ['API Error'], retryable: false });
  });

  it('使えるモデルの一覧は同じキーで同時に読みに行かず、読めなければ null(覚えておく)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const port = new GeminiAiPort({ apiKey: 'key-list-down' });
    expect(await Promise.all([port.availableModels(), port.availableModels()])).toEqual([null, null]);
    expect(await port.availableModels()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
