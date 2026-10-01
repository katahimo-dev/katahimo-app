import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyReportShapeIssues, GeminiAiPort } from './geminiAiPort';

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

  it('事故報告は指定したモデルで呼び、失敗に試し直す意味を付ける', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('busy', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await new GeminiAiPort({ apiKey: 'key-accident' }).generateAccidentReport({
      prompt: 'p',
      model: 'gemini-2.5-flash',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/models/gemini-2.5-flash:generateContent');
    expect(result).toMatchObject({ retryable: true });
  });

  it('領収書の読み取りは指定したモデルで 30秒で打ち切り、失敗に試し直す意味を付ける', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new GeminiAiPort({ apiKey: 'key-ocr' }).extractReceiptAmount({
      base64Image: 'data:image/jpeg;base64,AAAA',
      model: 'gemini-2.5-flash-lite',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/models/gemini-2.5-flash-lite:generateContent');
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(result).toMatchObject({ amount: '', retryable: false });
    timeout.mockRestore();
  });
});

describe('GeminiAiPort(運用のモデル比較の付帯情報)', () => {
  const okResponse = (text: string, usageMetadata?: Record<string, unknown>) =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
        ...(usageMetadata ? { usageMetadata } : {}),
      }),
      { status: 200 },
    );

  it('思考の量は指定したときだけ送り、トークン数と形の検証を付ける', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return okResponse('{"warnings":[],"internal":"社内","customer":"保護者"}', {
          promptTokenCount: 120,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 30,
          totalTokenCount: 190,
        });
      }),
    );
    const port = new GeminiAiPort({ apiKey: 'key-thinking' });
    const plain = await port.generateDailyReport({ prompt: 'p', model: 'gemini-2.5-flash' });
    const thinking = await port.generateDailyReport({
      prompt: 'p',
      model: 'gemini-2.5-flash',
      thinkingBudget: 0,
    });
    const configs = bodies.map((b) => b.generationConfig as Record<string, unknown>);
    expect(configs[0]).not.toHaveProperty('thinkingConfig');
    expect(configs[1]).toMatchObject({ thinkingConfig: { thinkingBudget: 0 } });
    expect(plain).toMatchObject({ internal: '社内', customer: '保護者' });
    expect(thinking.diagnostics).toEqual({
      shapeIssues: [],
      usage: { promptTokens: 120, candidatesTokens: 40, thoughtsTokens: 30, totalTokens: 190 },
    });
  });

  it('スキーマと違う応答は形の違いを残し(下書きは落として作る)、usageMetadata が無ければトークン数を付けない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse('{"warnings":"一つ","internal":"社内","psi":"3"}')),
    );
    const draft = await new GeminiAiPort({ apiKey: 'key-shape' }).generateDailyReport({ prompt: 'p' });
    expect(draft).toMatchObject({ warnings: [], internal: '社内', customer: '' });
    expect(draft.diagnostics).toEqual({ shapeIssues: ['missing:customer', 'type:warnings', 'type:psi'] });
    expect(dailyReportShapeIssues([1])).toEqual(['not_object']);
  });
});
