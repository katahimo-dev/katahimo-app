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
  text: string;
  start?: string;
  end?: string;
}

export interface DailyReportDraft {
  warnings: string[];
  internal: string;
  customer: string;
}

export interface GenerateAccidentReportInput {
  text: string;
  start?: string;
  end?: string;
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
