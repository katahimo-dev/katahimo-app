import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  DailyReportDraft,
  ReceiptOcrResult,
  ReportAiPort,
  ReportAiPortFactory,
} from '../ports/ai';
import type { CryptoPort } from '../ports/crypto';
import type { AppSettingsRepositoryPort } from '../ports/repositories';

export interface ReportAiDeps {
  /** テナントが独自のGemini APIキーを設定していない場合に使うフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  appSettings: AppSettingsRepositoryPort;
  crypto: CryptoPort;
  reportAiFactory: ReportAiPortFactory;
}

/**
 * テナントの管理者設定(app_settings)にGemini APIキーが保存されていればそれを使い、
 * 無ければ.env設定(deps.reportAi、未設定ならNoop)にフォールバックする。
 * GAS版がScript Properties一本を全ユーザーで共有していたのに対し、マルチテナントSaaSでは
 * テナントごとに異なるキー/モデルを持てる必要があるため、呼び出しのたびに解決する。
 */
async function resolveReportAiPort(deps: ReportAiDeps, tenantId: string): Promise<ReportAiPort> {
  const settings = await deps.appSettings.find(tenantId);
  if (!settings?.geminiApiKey) return deps.reportAi;
  const apiKey = await deps.crypto.decrypt(tenantId, settings.geminiApiKey);
  return deps.reportAiFactory.create({
    apiKey,
    reportModel: settings.geminiReportModel ?? undefined,
    ocrModel: settings.geminiOcrModel ?? undefined,
  });
}

/**
 * 保育日報のメモ(口語)からAI下書きを生成する。GAS版GeminiReport.js
 * generateReportWithWarningsに対応。APIキー未設定時・API呼び出し失敗時も例外にはせず、
 * warnings/internalにその旨を詰めた同じ形のオブジェクトを返す(GAS版と同じ)。
 */
export async function generateDailyReportDraft(
  deps: ReportAiDeps,
  tenantId: string,
  input: { text: string; start?: string; end?: string },
): Promise<DailyReportDraft> {
  const reportAi = await resolveReportAiPort(deps, tenantId);
  return reportAi.generateDailyReport(input);
}

/** GAS版GeminiReport.js generateAccidentReportに対応。失敗時は{error}を返す。 */
export async function generateAccidentReportDraft(
  deps: ReportAiDeps,
  tenantId: string,
  input: { text: string; start?: string; end?: string },
): Promise<AccidentReportDraft | AccidentReportDraftError> {
  const reportAi = await resolveReportAiPort(deps, tenantId);
  return reportAi.generateAccidentReport(input);
}

/** GAS版GeminiReport.js extractAmountFromImageに対応。失敗時も空値のフォールバックを返す。 */
export async function extractReceiptAmount(
  deps: ReportAiDeps,
  tenantId: string,
  base64Image: string,
): Promise<ReceiptOcrResult> {
  const reportAi = await resolveReportAiPort(deps, tenantId);
  return reportAi.extractReceiptAmount(base64Image);
}
