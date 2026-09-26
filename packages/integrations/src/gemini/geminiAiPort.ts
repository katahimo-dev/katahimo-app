import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  DailyReportDraft,
  GenerateAccidentReportInput,
  GenerateDailyReportInput,
  ReceiptOcrResult,
  ReportAiPort,
} from '@katahimo/core/ports';

const DEFAULT_MODEL_REPORT = 'gemini-2.5-flash';
const DEFAULT_MODEL_OCR = 'gemini-2.5-flash-lite';

type GeminiCallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; httpCode?: number; rawError?: string };

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
    });
    httpCode = response.status;
    responseText = await response.text();
  } catch (e) {
    return { ok: false, error: `System Error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (httpCode === 200) {
    try {
      const json = JSON.parse(responseText);
      const candidates = json.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return { ok: false, error: 'No candidates returned' };
      }
      const responseParts: Array<{ thought?: boolean; text?: string }> = candidates[0]?.content?.parts ?? [];
      const textPart = responseParts.find((p) => !p.thought) ?? responseParts[0];
      if (!textPart?.text) {
        return { ok: false, error: 'No text part found in response' };
      }
      const cleanText = textPart.text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanText);
      return { ok: true, value: unescapeNewlines(parsed) };
    } catch (_parseError) {
      return { ok: false, error: 'レスポンス解析エラー(サーバー側の問題の可能性があります)' };
    }
  }

  const rawError = responseText.slice(0, 500);
  switch (true) {
    case httpCode === 400:
      return { ok: false, error: 'リクエストが不正です(APIキーを確認してください)', httpCode, rawError };
    case httpCode === 401:
      return { ok: false, error: 'APIキーが無効です(設定を確認してください)', httpCode, rawError };
    case httpCode === 403:
      return {
        ok: false,
        error: 'API呼び出しが許可されていません(QuotaまたはAPI有効化を確認してください)',
        httpCode,
        rawError,
      };
    case httpCode === 429:
      return {
        ok: false,
        error: 'APIのレート制限に達しました。数分〜数時間待ってから再度お試しください。',
        httpCode,
        rawError,
      };
    case httpCode === 500:
      return {
        ok: false,
        error: 'Gemini API側で一時的なエラーが発生しました。数分〜数時間待ってから再度お試しください。',
        httpCode,
        rawError,
      };
    case httpCode === 503:
      return {
        ok: false,
        error:
          'Gemini APIサービスが混み合っており、一時的に利用できません。数分〜数時間待ってから再度お試しください。',
        httpCode,
        rawError,
      };
    case httpCode >= 500:
      return {
        ok: false,
        error: `Gemini APIサーバーエラー(${httpCode})が発生しました。数分〜数時間待ってから再度お試しください。`,
        httpCode,
        rawError,
      };
    default:
      return { ok: false, error: `API呼び出しエラー(${httpCode})`, httpCode, rawError };
  }
}

export interface GeminiAiPortOptions {
  apiKey: string;
  reportModel?: string;
  ocrModel?: string;
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

export class GeminiAiPort implements ReportAiPort {
  constructor(private readonly options: GeminiAiPortOptions) {}

  get reportModel(): string {
    return this.options.reportModel || DEFAULT_MODEL_REPORT;
  }

  async generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft> {
    const result = await callGemini(
      this.options.apiKey,
      [{ text: input.prompt }],
      { responseMimeType: 'application/json', responseSchema: DAILY_REPORT_RESPONSE_SCHEMA },
      this.reportModel,
    );

    if (!result.ok) {
      const detail = result.rawError ? `${result.error}\n\n[詳細] ${result.rawError}` : result.error;
      return { warnings: ['API Error'], internal: detail, customer: '' };
    }
    return toDailyDraft(result.value);
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
      this.reportModel,
    );

    if (!result.ok) return { error: result.error };
    return result.value as AccidentReportDraft;
  }

  async extractReceiptAmount(base64Image: string): Promise<ReceiptOcrResult> {
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

    const rawBase64 = base64Image.split(',')[1] ?? '';
    const result = await callGemini(
      this.options.apiKey,
      [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: rawBase64 } }],
      null,
      this.options.ocrModel || DEFAULT_MODEL_OCR,
    );

    if (!result.ok) return { amount: '', storeName: '', receiptDate: '', error: result.error };
    return result.value as ReceiptOcrResult;
  }
}

/** GEMINI_API_KEY未設定時のフォールバック。GAS版のapiKey未設定時の挙動と同じ値を返す。 */
export class NoopReportAiPort implements ReportAiPort {
  readonly reportModel = null;

  async generateDailyReport(): Promise<DailyReportDraft> {
    return { warnings: ['API Key Missing'], internal: 'Error: API Key not set', customer: '' };
  }

  async generateAccidentReport(): Promise<AccidentReportDraftError> {
    return { error: 'API Key Missing' };
  }

  async extractReceiptAmount(): Promise<ReceiptOcrResult> {
    return { amount: '', storeName: '', receiptDate: '', error: 'API Key Missing' };
  }
}
