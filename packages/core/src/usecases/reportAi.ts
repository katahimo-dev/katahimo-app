import { AI_PROMPT_KEYS } from '@katahimo/shared';
import { ENCRYPTION_PURPOSES } from '../domain/pii';
import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  DailyReportDraft,
  ReceiptOcrResult,
  ReportAiPort,
  ReportAiPortFactory,
} from '../ports/ai';
import type { AppLogPort } from '../ports/appLog';
import type { CryptoPort } from '../ports/crypto';
import type { AppSettingsRepositoryPort } from '../ports/repositories';
import type { AiPromptDeps } from './aiPrompts';
import { resolvePromptBody } from './aiPrompts';

export interface ReportAiDeps extends AiPromptDeps {
  /** テナントが独自のGemini APIキーを設定していない場合に使うフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  appSettings: AppSettingsRepositoryPort;
  crypto: CryptoPort;
  reportAiFactory: ReportAiPortFactory;
  appLog: AppLogPort;
}

export interface ReportAiCaller {
  tenantId: string;
  staffId: string;
}

/**
 * テナントの管理者設定(app_settings)にGemini APIキーが保存されていればそれを使い、
 * 無ければ.env設定(deps.reportAi、未設定ならNoop)にフォールバックする。
 */
async function resolveReportAiPort(deps: ReportAiDeps, tenantId: string): Promise<ReportAiPort> {
  const settings = await deps.appSettings.find(tenantId);
  if (!settings?.geminiApiKey) return deps.reportAi;
  return deps.reportAiFactory.create({
    apiKey: await deps.crypto.decrypt(tenantId, settings.geminiApiKey, ENCRYPTION_PURPOSES.geminiApiKey),
    reportModel: settings.geminiReportModel ?? undefined,
    ocrModel: settings.geminiOcrModel ?? undefined,
  });
}

function logAiError(deps: ReportAiDeps, caller: ReportAiCaller, action: string, error: string) {
  return deps.appLog.write({
    tenantId: caller.tenantId,
    level: 'ERROR',
    action,
    actorStaffId: caller.staffId,
    details: { error: error.slice(0, 300) },
  });
}

/**
 * 保育日報のメモ(口語)からAI下書きを生成する。GAS版GeminiReport.js generateReportWithWarningsに対応。
 * プロンプトはテナントが管理画面で編集したもの(無ければ既定値)を使う。失敗時も例外にはせず、
 * warnings/internalにその旨を詰めた同じ形のオブジェクトを返す(GAS版と同じ)。
 */
export async function generateDailyReportDraft(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  input: { text: string; start?: string; end?: string },
): Promise<DailyReportDraft> {
  const [reportAi, promptTemplate] = await Promise.all([
    resolveReportAiPort(deps, caller.tenantId),
    resolvePromptBody(deps, caller.tenantId, AI_PROMPT_KEYS.DAILY_REPORT_GENERATE),
  ]);
  const draft = await reportAi.generateDailyReport({ ...input, promptTemplate });
  if (draft.warnings.includes('API Error') || draft.warnings.includes('API Key Missing')) {
    await logAiError(deps, caller, 'ai.daily_report.generate_failed', draft.internal);
  }
  return draft;
}

/** GAS版GeminiReport.js generateAccidentReportに対応。失敗時は{error}を返す。 */
export async function generateAccidentReportDraft(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  input: { text: string; start?: string; end?: string },
): Promise<AccidentReportDraft | AccidentReportDraftError> {
  const [reportAi, promptTemplate] = await Promise.all([
    resolveReportAiPort(deps, caller.tenantId),
    resolvePromptBody(deps, caller.tenantId, AI_PROMPT_KEYS.ACCIDENT_REPORT_GENERATE),
  ]);
  const draft = await reportAi.generateAccidentReport({ ...input, promptTemplate });
  if ('error' in draft) await logAiError(deps, caller, 'ai.accident_report.generate_failed', draft.error);
  return draft;
}

/** GAS版GeminiReport.js extractAmountFromImageに対応。失敗時も空値のフォールバックを返す。 */
export async function extractReceiptAmount(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  base64Image: string,
): Promise<ReceiptOcrResult> {
  const reportAi = await resolveReportAiPort(deps, caller.tenantId);
  const result = await reportAi.extractReceiptAmount(base64Image);
  if (result.error) await logAiError(deps, caller, 'ai.receipt_ocr.failed', result.error);
  return result;
}
