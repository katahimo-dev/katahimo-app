/**
 * 日報/事故報告のAI生成・領収書OCRのポート。
 * GAS版 GeminiReport.js の callGemini/generateReportWithWarnings/generateAccidentReport/
 * extractAmountFromImage に対応する。実装は @katahimo/integrations の gemini アダプタ
 * (Gemini API を実際に呼ぶ)と、APIキー未設定時に使うno-op実装の2種類を想定する。
 *
 * 戻り値の形はGAS版に意図的に合わせている(統一エラー型でラップしていない):
 * - generateDailyReport: 失敗時もエラーにはせず、warnings/internalにエラー内容を詰めた
 *   同じ形のオブジェクトを返す(GAS版generateReportWithWarningsと同じ。呼び出し元UIが
 *   常に同じ形として扱えるようにするための設計)。
 * - generateAccidentReport: 失敗時は{error}を返す(GAS版generateAccidentReportと同じ)。
 * - extractReceiptAmount: 失敗時も空値のフォールバックを返す(領収書登録そのものは
 *   手入力でも成立するため。GAS版extractAmountFromImageと同じ)。ただしGAS版と異なり
 *   `error`にエラー内容を詰める(手入力へのフォールバックは維持しつつ、失敗した事実は
 *   画面に表示するため)。
 */

export interface GenerateDailyReportInput {
  /**
   * モデルに送るプロンプトの全文。テナントの文面(無ければ @katahimo/shared の既定値)に入力メモ・時間情報・
   * 日報AIの3軸の差し込みを入れたもの(usecases/reportAi.ts が core/domain/reports/promptAssembly.ts で組み立てる)。
   */
  prompt: string;
  /** 使うモデル(省略時は reportModel)。API エラーのとき usecase が次のモデルを指定して呼び直す。 */
  model?: string;
}

export interface DailyReportDraft {
  warnings: string[];
  internal: string;
  customer: string;
  /** AI が使ったと答えた教育キーワード(「K11 粗大運動」など。答えが無ければ undefined)。 */
  usedKeywords?: string[];
  /** AI が判定・確認した PSI・教育思考★(検証用。答えが無ければ undefined)。 */
  psi?: number;
  eduLevel?: number;
  /**
   * API エラー('API Error')のとき、別のモデルで試し直す意味があるか(API キーの誤り・権限は false。
   * 混雑・上限・モデルが無い等は true)。成功時は undefined。
   */
  retryable?: boolean;
}

export interface GenerateAccidentReportInput {
  /** GenerateDailyReportInput.prompt と同じ(入力メモ・時間情報を差し込んだ全文)。 */
  prompt: string;
}

export interface AccidentReportDraft {
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
}

export interface AccidentReportDraftError {
  error: string;
}

export interface ReceiptOcrResult {
  amount: string | number;
  storeName: string;
  /** 'yyyy/MM/dd HH:mm' 形式。読み取れなければ空文字。 */
  receiptDate: string;
  /**
   * OCR呼び出し自体が失敗した場合のエラーメッセージ(GAS版は空値フォールバックのみで
   * エラーを一切伝えていなかったが、失敗時に無言のままなのは不親切なため追加した)。
   * 成功時・APIキー未設定でもエラー扱いにしない場合はundefined。
   */
  error?: string;
}

export interface ReportAiPort {
  /** 日報・事故報告に使うモデル名(記録に残す。API キーが無い実装は null)。 */
  readonly reportModel: string | null;
  /**
   * この API キーで使えるモデルの名前(ListModels。日報のモデルの切り替え先を決める)。読めなければ null。
   * 無い実装は既知の名前(core/domain/reports/modelFallback.ts)で切り替える。
   */
  availableModels?(): Promise<string[] | null>;
  generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft>;
  generateAccidentReport(
    input: GenerateAccidentReportInput,
  ): Promise<AccidentReportDraft | AccidentReportDraftError>;
  extractReceiptAmount(base64Image: string): Promise<ReceiptOcrResult>;
}

export interface ReportAiPortOptions {
  apiKey: string;
  reportModel?: string;
  ocrModel?: string;
}

/**
 * テナントが管理者設定画面で独自のGemini APIキーを保存している場合、そのキー/モデルで
 * 都度 ReportAiPort を組み立てるためのファクトリ。usecases/reportAi.ts の
 * resolveReportAiPort が、.env設定のフォールバック(単一インスタンス)とこのファクトリを
 * 使い分ける。
 */
export interface ReportAiPortFactory {
  create(options: ReportAiPortOptions): ReportAiPort;
}
