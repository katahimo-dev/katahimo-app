import { createHash } from 'node:crypto';
import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  AiFailure,
  AiFailureReason,
  DailyReportDraft,
  ExtractReceiptAmountInput,
  GenerateAccidentReportInput,
  GenerateDailyReportInput,
  ReceiptOcrResult,
  ReportAiPort,
  ReportAiTokenUsage,
} from '@katahimo/core/ports';
import { listAvailableGeminiModels } from './listModels';

/**
 * モデルを渡されなかったときの既定(usecase は core/domain/reports/modelFallback.ts の順で決めて必ず渡す。
 * これは直接呼んだとき用で、その順の先頭と同じ -latest の別名)。
 */
const DEFAULT_MODEL_REPORT = 'gemini-flash-latest';
const DEFAULT_MODEL_OCR = 'gemini-flash-lite-latest';

/**
 * 1回の generateContent の上限。画面は1つのモデルを90秒で見切って次のモデルに移るので、それより前にサーバー側でも
 * 切る(見切られた呼び出しが走り続けて課金・記録だけが残らないように)。
 */
const GENERATE_TIMEOUT_MS = 80_000;
/** 領収書の読み取り1回の上限(サーバーの中で最大3モデルを順に試すので、画面を長く待たせない)。 */
const OCR_TIMEOUT_MS = 30_000;

type GeminiCallResult =
  | { ok: true; value: unknown; usage?: ReportAiTokenUsage }
  | { ok: false; error: string; reason: AiFailureReason; httpCode?: number; rawError?: string };

/** 値の中の全ての文字列に含まれる `\n`(エスケープされた改行)を実際の改行に戻す。GAS版callGeminiのunescapeNewlinesと同じ。 */
function unescapeNewlines(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\\n/g, '\n');
  if (Array.isArray(value)) return value.map(unescapeNewlines);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = unescapeNewlines(v);
    }
    return result;
  }
  return value;
}

/** 応答の usageMetadata のトークン数(数で返ってきた項目だけ。無ければ undefined)。 */
function usageOf(json: unknown): ReportAiTokenUsage | undefined {
  const meta = (json as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!meta || typeof meta !== 'object') return undefined;
  const usage: ReportAiTokenUsage = {};
  const pick = (key: string, field: keyof ReportAiTokenUsage) => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) usage[field] = value;
  };
  pick('promptTokenCount', 'promptTokens');
  pick('candidatesTokenCount', 'candidatesTokens');
  pick('thoughtsTokenCount', 'thoughtsTokens');
  pick('totalTokenCount', 'totalTokens');
  return Object.keys(usage).length > 0 ? usage : undefined;
}

/**
 * Gemini generateContent APIを呼ぶ。GAS版GeminiReport.js callGeminiに対応
 * (思考パートのスキップ・マークダウンのコードフェンス除去・改行アンエスケープ・
 * HTTPステータスコード別の日本語エラーメッセージも含めて完全に同じ挙動にする)。
 */
async function callGemini(
  apiKey: string,
  contentParts: unknown[],
  generationConfig: Record<string, unknown> | null,
  modelName: string,
  timeoutMs: number = GENERATE_TIMEOUT_MS,
): Promise<GeminiCallResult> {
  // APIキーはURLに載せずヘッダーで送る(URLはプロキシ・アクセスログに残りやすいため)。
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
  const payload = {
    contents: [{ parts: contentParts }],
    generationConfig: generationConfig || { responseMimeType: 'application/json' },
  };

  let httpCode: number;
  let responseText: string;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    httpCode = response.status;
    responseText = await response.text();
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      return {
        ok: false,
        error: 'Gemini APIの応答に時間がかかりすぎたため、打ち切りました。',
        reason: 'timeout',
      };
    }
    return {
      ok: false,
      error: `System Error: ${e instanceof Error ? e.message : String(e)}`,
      reason: 'network_error',
    };
  }

  if (httpCode === 200) {
    try {
      const json = JSON.parse(responseText);
      const candidates = json.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return { ok: false, error: 'No candidates returned', reason: 'empty_response' };
      }
      const responseParts: Array<{ thought?: boolean; text?: string }> = candidates[0]?.content?.parts ?? [];
      const textPart = responseParts.find((p) => !p.thought) ?? responseParts[0];
      if (!textPart?.text) {
        return { ok: false, error: 'No text part found in response', reason: 'empty_response' };
      }
      const cleanText = textPart.text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanText);
      const usage = usageOf(json);
      return { ok: true, value: unescapeNewlines(parsed), ...(usage ? { usage } : {}) };
    } catch (_parseError) {
      return {
        ok: false,
        error: 'レスポンス解析エラー(サーバー側の問題の可能性があります)',
        reason: 'invalid_response',
      };
    }
  }

  const rawError = responseText.slice(0, 500);
  return { ok: false, error: httpErrorMessage(httpCode), reason: 'http_error', httpCode, rawError };
}

/** HTTP の状態ごとの日本語の文(GAS版 callGemini と同じ)。 */
function httpErrorMessage(httpCode: number): string {
  switch (true) {
    case httpCode === 400:
      return 'リクエストが不正です(APIキーを確認してください)';
    case httpCode === 401:
      return 'APIキーが無効です(設定を確認してください)';
    case httpCode === 403:
      return 'API呼び出しが許可されていません(QuotaまたはAPI有効化を確認してください)';
    case httpCode === 429:
      return 'APIのレート制限に達しました。数分〜数時間待ってから再度お試しください。';
    case httpCode === 500:
      return 'Gemini API側で一時的なエラーが発生しました。数分〜数時間待ってから再度お試しください。';
    case httpCode === 503:
      return 'Gemini APIサービスが混み合っており、一時的に利用できません。数分〜数時間待ってから再度お試しください。';
    case httpCode >= 500:
      return `Gemini APIサーバーエラー(${httpCode})が発生しました。数分〜数時間待ってから再度お試しください。`;
    default:
      return `API呼び出しエラー(${httpCode})`;
  }
}

export interface GeminiAiPortOptions {
  apiKey: string;
}

/** GAS版GeminiReport.jsのAPI呼び出しロジックを実装するReportAiPort。GEMINI_API_KEYが設定されている場合に使う。 */
/**
 * 保育日報の応答のスキーマ。warnings / internal / customer は GAS版 generateReportWithWarnings の dailyReportSchema と
 * 同じ(必須)。日報AIの3軸で足した psi / eduLevel / usedKeywords(お客様のプロンプト変更案の出力フォーマット)は
 * 任意(キーワード表を使わないテナントでも同じスキーマで通る)。
 */
export const DAILY_REPORT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
    internal: { type: 'STRING' },
    customer: { type: 'STRING' },
    psi: { type: 'INTEGER' },
    eduLevel: { type: 'INTEGER' },
    usedKeywords: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['warnings', 'internal', 'customer'],
} as const;

/**
 * 応答が DAILY_REPORT_RESPONSE_SCHEMA と違う点(必須の項目が無い・型が違う)。空なら形どおり。toDailyDraft は形の
 * 違う値を落として下書きを作るため、その前の値を確かめる(運用のモデル比較 `pnpm ai:compare` の「JSON の形」)。
 */
export function dailyReportShapeIssues(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['not_object'];
  const v = value as Record<string, unknown>;
  const issues: string[] = [];
  const isStringArray = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');
  const isInteger = (x: unknown) => typeof x === 'number' && Number.isInteger(x);
  for (const key of DAILY_REPORT_RESPONSE_SCHEMA.required) {
    if (!(key in v)) issues.push(`missing:${key}`);
  }
  if ('warnings' in v && !isStringArray(v.warnings)) issues.push('type:warnings');
  if ('internal' in v && typeof v.internal !== 'string') issues.push('type:internal');
  if ('customer' in v && typeof v.customer !== 'string') issues.push('type:customer');
  if ('usedKeywords' in v && !isStringArray(v.usedKeywords)) issues.push('type:usedKeywords');
  if ('psi' in v && !isInteger(v.psi)) issues.push('type:psi');
  if ('eduLevel' in v && !isInteger(v.eduLevel)) issues.push('type:eduLevel');
  return issues;
}

/** 応答を日報の下書きにする(形が違う値は落とす。warnings・internal・customer は無ければ空)。 */
function toDailyDraft(value: unknown): DailyReportDraft {
  const v = (value ?? {}) as Record<string, unknown>;
  const strings = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  const draft: DailyReportDraft = {
    warnings: strings(v.warnings),
    internal: typeof v.internal === 'string' ? v.internal : '',
    customer: typeof v.customer === 'string' ? v.customer : '',
  };
  if (Array.isArray(v.usedKeywords)) draft.usedKeywords = strings(v.usedKeywords);
  if (typeof v.psi === 'number' && Number.isInteger(v.psi)) draft.psi = v.psi;
  if (typeof v.eduLevel === 'number' && Number.isInteger(v.eduLevel)) draft.eduLevel = v.eduLevel;
  return draft;
}

/** 失敗の理由コード(操作ログ用。文・応答の本文は入れない)。 */
function failureOf(result: Extract<GeminiCallResult, { ok: false }>): AiFailure {
  return { reason: result.reason, ...(result.httpCode !== undefined ? { httpStatus: result.httpCode } : {}) };
}

/**
 * 別のモデルで試し直す意味がある失敗か。API キーの誤り(401・403、400 の API_KEY_INVALID)はどのモデルでも
 * 同じなので false。混雑・上限(429・5xx)、モデルが無い(404)、通信・応答の解析の失敗は true。
 */
function isRetryableFailure(result: Extract<GeminiCallResult, { ok: false }>): boolean {
  if (result.httpCode === 401 || result.httpCode === 403) return false;
  if (result.httpCode === 400 && result.rawError?.includes('API_KEY_INVALID')) return false;
  return true;
}

/** 使えるモデルの一覧の覚えておく時間(ListModels はモデルの入れ替わりでしか変わらない)。 */
const MODEL_LIST_TTL_MS = 6 * 60 * 60 * 1000;
/** 一覧が読めなかったときに、次に読みに行くまでの時間。 */
const MODEL_LIST_FAILURE_TTL_MS = 5 * 60 * 1000;
/** API キーの SHA-256 → 一覧(null = 読めなかった)。テナントごとに鍵が違うのでキーで分ける。 */
const modelListCache = new Map<string, { expiresAt: number; models: string[] | null }>();

/** 読みに行っている途中の一覧(同じキーで同時に読みに行かない)。 */
const modelListInFlight = new Map<string, Promise<string[] | null>>();
/** 一覧を読む上限(生成の前に読むので、止まったら既知の名前ですぐ進む)。 */
const MODEL_LIST_TIMEOUT_MS = 5_000;

async function cachedModelList(apiKey: string): Promise<string[] | null> {
  const key = createHash('sha256').update(apiKey).digest('hex');
  const hit = modelListCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.models;
  const inFlight = modelListInFlight.get(key);
  if (inFlight) return inFlight;
  const loading = (async () => {
    let models: string[] | null;
    try {
      models = (await listAvailableGeminiModels(apiKey, { timeoutMs: MODEL_LIST_TIMEOUT_MS })).map(
        (m) => m.name,
      );
    } catch {
      models = null;
    }
    modelListCache.set(key, {
      expiresAt: Date.now() + (models ? MODEL_LIST_TTL_MS : MODEL_LIST_FAILURE_TTL_MS),
      models,
    });
    return models;
  })().finally(() => modelListInFlight.delete(key));
  modelListInFlight.set(key, loading);
  return loading;
}

export class GeminiAiPort implements ReportAiPort {
  constructor(private readonly options: GeminiAiPortOptions) {}

  readonly hasApiKey = true;

  availableModels(): Promise<string[] | null> {
    return cachedModelList(this.options.apiKey);
  }

  async generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft> {
    const result = await callGemini(
      this.options.apiKey,
      [{ text: input.prompt }],
      {
        responseMimeType: 'application/json',
        responseSchema: DAILY_REPORT_RESPONSE_SCHEMA,
        // 思考の量は指定したときだけ送る(運用のモデル比較だけ。アプリの生成はモデルの既定のまま)
        ...(input.thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget: input.thinkingBudget } }
          : {}),
      },
      input.model || DEFAULT_MODEL_REPORT,
    );

    if (!result.ok) {
      const detail = result.rawError ? `${result.error}\n\n[詳細] ${result.rawError}` : result.error;
      return {
        warnings: ['API Error'],
        internal: detail,
        customer: '',
        retryable: isRetryableFailure(result),
        failure: failureOf(result),
      };
    }
    const diagnostics = {
      shapeIssues: dailyReportShapeIssues(result.value),
      ...(result.usage ? { usage: result.usage } : {}),
    };
    return { ...toDailyDraft(result.value), diagnostics };
  }

  async generateAccidentReport(
    input: GenerateAccidentReportInput,
  ): Promise<AccidentReportDraft | AccidentReportDraftError> {
    const prompt = input.prompt;

    const schema = {
      type: 'OBJECT',
      properties: {
        occurrenceTime: { type: 'STRING' },
        location: { type: 'STRING' },
        accidentContent: { type: 'STRING' },
        situation: { type: 'STRING' },
        immediateResponse: { type: 'STRING' },
        parentCorrespondence: { type: 'STRING' },
        diagnosisTreatment: { type: 'STRING' },
        prevention: { type: 'STRING' },
      },
      required: [
        'occurrenceTime',
        'location',
        'accidentContent',
        'situation',
        'immediateResponse',
        'parentCorrespondence',
        'diagnosisTreatment',
        'prevention',
      ],
    };

    const result = await callGemini(
      this.options.apiKey,
      [{ text: prompt }],
      { responseMimeType: 'application/json', responseSchema: schema },
      input.model || DEFAULT_MODEL_REPORT,
    );

    if (!result.ok) {
      return { error: result.error, retryable: isRetryableFailure(result), failure: failureOf(result) };
    }
    return result.value as AccidentReportDraft;
  }

  async extractReceiptAmount(input: ExtractReceiptAmountInput): Promise<ReceiptOcrResult> {
    const prompt = `
    Analyze the image of this receipt.
    Identify the following information:
    1. Total Amount (Total, 合計, 支払い金額)
    2. Store Name or Parking Name (店舗名や駐車場名など、発行元の名称)
    3. Date and Time of transaction (取引日時や精算日時).
       - Look for keywords like "取引日時", "精算時刻", "発行日時", "20XX年XX月XX日".
       - Format as "yyyy/MM/dd HH:mm".
       - If time is not found but date is, use "yyyy/MM/dd 00:00".
       - If not found at all, return "".

    Return the result in JSON format: {"amount": number, "storeName": "string", "receiptDate": "string"}
    Do NOT include currency symbols or commas in the amount.
    `;

    const rawBase64 = input.base64Image.split(',')[1] ?? '';
    const result = await callGemini(
      this.options.apiKey,
      [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: rawBase64 } }],
      null,
      input.model || DEFAULT_MODEL_OCR,
      OCR_TIMEOUT_MS,
    );

    if (!result.ok) {
      return {
        amount: '',
        storeName: '',
        receiptDate: '',
        error: result.error,
        retryable: isRetryableFailure(result),
        failure: failureOf(result),
      };
    }
    return result.value as ReceiptOcrResult;
  }
}

/** GEMINI_API_KEY未設定時のフォールバック。GAS版のapiKey未設定時の挙動と同じ値を返す。 */
export class NoopReportAiPort implements ReportAiPort {
  readonly hasApiKey = false;

  async generateDailyReport(): Promise<DailyReportDraft> {
    return {
      warnings: ['API Key Missing'],
      internal: 'Error: API Key not set',
      customer: '',
      failure: { reason: 'api_key_missing' },
    };
  }

  async generateAccidentReport(): Promise<AccidentReportDraftError> {
    return { error: 'API Key Missing', failure: { reason: 'api_key_missing' } };
  }

  async extractReceiptAmount(): Promise<ReceiptOcrResult> {
    return {
      amount: '',
      storeName: '',
      receiptDate: '',
      error: 'API Key Missing',
      failure: { reason: 'api_key_missing' },
    };
  }
}
