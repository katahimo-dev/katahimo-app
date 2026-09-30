import type { AiApiKeyVerification, AiApiKeyVerifierPort } from '@katahimo/core/ports';

export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

/** ListModels が 200 以外を返した(応答本文はアプリログに残るため持たない)。 */
export class GeminiListModelsError extends Error {
  constructor(readonly status: number) {
    super(`モデル一覧の取得に失敗しました(HTTP ${status})`);
    this.name = 'GeminiListModelsError';
  }
}

/**
 * 指定APIキーで実際に使えるモデル一覧を取得する(ListModels)。generateContentに対応している
 * モデルのみを返す。GAS版GeminiReport.js listAvailableGeminiModelsForAdminのAPI呼び出し部分に
 * 対応(保存前の入力中キーでも確認できるよう、常に呼び出し元から明示的にapiKeyを受け取る)。
 */
export async function listAvailableGeminiModels(
  apiKey: string,
  options: { timeoutMs?: number; pageSize?: number; maxPages?: number } = {},
): Promise<GeminiModelInfo[]> {
  const models: GeminiModelInfo[] = [];
  // 全ページ合わせての上限(指定したときだけ。日報のモデルの切り替えは生成の前に読むので止まらないようにする)
  const signal = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined;
  let pageToken = '';
  let pageCount = 0;

  do {
    let url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=${options.pageSize ?? 100}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    // APIキーはURLに載せずヘッダーで送る。失敗時の応答本文はエラーに含めない(アプリログに残るため)。
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': apiKey },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GeminiListModelsError(response.status);
    }

    const json = (await response.json()) as {
      models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of json.models ?? []) {
      const methods = m.supportedGenerationMethods ?? [];
      if (methods.includes('generateContent')) {
        models.push({ name: (m.name ?? '').replace(/^models\//, ''), displayName: m.displayName ?? '' });
      }
    }
    pageToken = json.nextPageToken ?? '';
    pageCount++;
  } while (pageToken && pageCount < (options.maxPages ?? 5));

  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

/** API キーの確認の上限(管理者が「保存する」を押してから待つ時間)。 */
export const API_KEY_VERIFY_TIMEOUT_MS = 8_000;

/**
 * 保存する前の Gemini API キーを確かめる(ListModels を 1ページだけ。生成はしないので課金されず、キーが使えることと
 * 日報に使うモデルが一覧にあることを1回の呼び出しで確かめられる)。例外は投げず、結果の形で返す:
 * 400・401・403 → key_rejected(キーの誤り・無効・API が有効でない)、429 → rate_limited、
 * それ以外の HTTP エラー・通信の失敗・応答の形の違い → unreachable、時間切れ → timeout。
 */
export async function verifyGeminiApiKey(
  apiKey: string,
  options: { timeoutMs?: number } = {},
): Promise<AiApiKeyVerification> {
  try {
    const models = await listAvailableGeminiModels(apiKey, {
      timeoutMs: options.timeoutMs ?? API_KEY_VERIFY_TIMEOUT_MS,
      pageSize: 1000,
      maxPages: 1,
    });
    return { ok: true, models: models.map((m) => m.name) };
  } catch (e) {
    if (e instanceof GeminiListModelsError) {
      if (e.status === 400 || e.status === 401 || e.status === 403) {
        return { ok: false, reason: 'key_rejected', httpStatus: e.status };
      }
      if (e.status === 429) return { ok: false, reason: 'rate_limited', httpStatus: e.status };
      return { ok: false, reason: 'unreachable', httpStatus: e.status };
    }
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'unreachable' };
  }
}

/** 本番の API キーの確認(Gemini の ListModels に問い合わせる)。 */
export class GeminiApiKeyVerifier implements AiApiKeyVerifierPort {
  verifyApiKey(apiKey: string): Promise<AiApiKeyVerification> {
    return verifyGeminiApiKey(apiKey);
  }
}

/**
 * 問い合わせずに成功を返す確認(テスト・オフラインの開発用。結合テストが実際の Gemini につながないように使う)。
 * 返すモデルは日報に使う既知の名前(一覧に日報のモデルがある扱い)。
 */
export class NoopAiApiKeyVerifier implements AiApiKeyVerifierPort {
  async verifyApiKey(): Promise<AiApiKeyVerification> {
    return { ok: true, models: ['gemini-flash-latest', 'gemini-flash-lite-latest'] };
  }
}
