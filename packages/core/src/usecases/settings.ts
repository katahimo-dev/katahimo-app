import type { AppLogPort } from '../ports/appLog';
import type { CryptoPort } from '../ports/crypto';
import type { AppSettingsRepositoryPort } from '../ports/repositories';
import type { RequestMeta } from './requestMeta';

export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

export interface SettingsDeps {
  appSettings: AppSettingsRepositoryPort;
  crypto: CryptoPort;
  appLog: AppLogPort;
  /** Gemini ListModels(@katahimo/integrationsのlistAvailableGeminiModels)。失敗時は例外を投げる。 */
  listGeminiModels: (apiKey: string) => Promise<GeminiModelInfo[]>;
}

/** 設定を操作した管理者(ログ記録用。権限確認はAPIルート側で済ませてから呼ぶ)。 */
export interface SettingsActor {
  tenantId: string;
  staffId: string;
  meta?: RequestMeta;
}

/** GAS版GeminiReport.jsのGEMINI_MODEL_REPORT_DEFAULT/GEMINI_MODEL_OCR_DEFAULTと同じ値。 */
export const DEFAULT_GEMINI_REPORT_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_OCR_MODEL = 'gemini-2.5-flash-lite';

export interface AdminSettingsView {
  geminiApiKey: string;
  geminiReportModel: string;
  geminiOcrModel: string;
  gchatReportWebhookUrl: string;
  gchatReceiptWebhookUrl: string;
}

export type SaveSettingsResult =
  | { ok: true; changed: boolean; message: string }
  | { ok: false; reason: 'empty'; message: string };

function writeLog(
  deps: SettingsDeps,
  actor: SettingsActor,
  level: 'INFO' | 'WARN' | 'ERROR' | 'SECURITY',
  action: string,
  details?: Record<string, unknown>,
) {
  return deps.appLog.write({
    tenantId: actor.tenantId,
    level,
    action,
    actorStaffId: actor.staffId,
    details,
    ...actor.meta,
  });
}

async function decryptOrEmpty(
  deps: SettingsDeps,
  tenantId: string,
  value: { ciphertext: string; keyVersion: number } | null,
) {
  return value ? deps.crypto.decrypt(tenantId, value) : '';
}

/**
 * 管理者設定画面用の現在値を復号して返す。GAS版のgetGeminiApiKeyForAdmin/
 * getGeminiModelSettingsForAdmin/getGoogleChatWebhookSettingsForAdminをまとめたもの。
 * APIキー・Webhook URLを平文で返すため、閲覧をSECURITYログに残す(GAS版GeminiApiKeyViewed/
 * GoogleChatWebhookSettingsViewedに相当)。
 */
export async function getAdminSettings(deps: SettingsDeps, actor: SettingsActor): Promise<AdminSettingsView> {
  const row = await deps.appSettings.find(actor.tenantId);
  const [geminiApiKey, gchatReportWebhookUrl, gchatReceiptWebhookUrl] = await Promise.all([
    decryptOrEmpty(deps, actor.tenantId, row?.geminiApiKey ?? null),
    decryptOrEmpty(deps, actor.tenantId, row?.gchatReportWebhookUrl ?? null),
    decryptOrEmpty(deps, actor.tenantId, row?.gchatReceiptWebhookUrl ?? null),
  ]);
  await writeLog(deps, actor, 'SECURITY', 'settings.secrets.viewed', {
    items: ['geminiApiKey', 'gchatReportWebhookUrl', 'gchatReceiptWebhookUrl'],
  });
  return {
    geminiApiKey,
    geminiReportModel: row?.geminiReportModel || DEFAULT_GEMINI_REPORT_MODEL,
    geminiOcrModel: row?.geminiOcrModel || DEFAULT_GEMINI_OCR_MODEL,
    gchatReportWebhookUrl,
    gchatReceiptWebhookUrl,
  };
}

/**
 * Gemini APIキーを保存する。GAS版saveGeminiApiKeyForAdminと同じく、空文字での保存は既存キーの
 * 意図しない消失を防ぐため拒否し、同じ値なら何もしない。
 */
export async function saveGeminiApiKey(
  deps: SettingsDeps,
  actor: SettingsActor,
  apiKey: string,
): Promise<SaveSettingsResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await writeLog(deps, actor, 'WARN', 'settings.gemini_api_key.save_rejected', { reason: 'empty' });
    return {
      ok: false,
      reason: 'empty',
      message: 'APIキーが空です。空のまま保存すると既存のキーが失われるため、保存を中止しました。',
    };
  }
  const row = await deps.appSettings.find(actor.tenantId);
  if ((await decryptOrEmpty(deps, actor.tenantId, row?.geminiApiKey ?? null)) === trimmed) {
    return { ok: true, changed: false, message: 'Gemini APIキーは変更ありません。' };
  }
  await deps.appSettings.upsert(actor.tenantId, {
    geminiApiKey: await deps.crypto.encrypt(actor.tenantId, trimmed),
  });
  await writeLog(deps, actor, 'SECURITY', 'settings.gemini_api_key.changed');
  return { ok: true, changed: true, message: 'Gemini APIキーを保存しました。' };
}

/** GAS版saveGeminiModelSettingsForAdminと同じガード(どちらか一方でも空なら拒否、同じ値なら何もしない)。 */
export async function saveGeminiModelSettings(
  deps: SettingsDeps,
  actor: SettingsActor,
  reportModel: string,
  ocrModel: string,
): Promise<SaveSettingsResult> {
  const trimmedReport = reportModel.trim();
  const trimmedOcr = ocrModel.trim();
  if (!trimmedReport || !trimmedOcr) {
    await writeLog(deps, actor, 'WARN', 'settings.gemini_models.save_rejected', { reason: 'empty' });
    return {
      ok: false,
      reason: 'empty',
      message: 'モデルが未選択です。空のまま保存すると既存の設定が失われるため、保存を中止しました。',
    };
  }
  const row = await deps.appSettings.find(actor.tenantId);
  const currentReport = row?.geminiReportModel || DEFAULT_GEMINI_REPORT_MODEL;
  const currentOcr = row?.geminiOcrModel || DEFAULT_GEMINI_OCR_MODEL;
  if (currentReport === trimmedReport && currentOcr === trimmedOcr) {
    return { ok: true, changed: false, message: 'モデル設定は変更ありません。' };
  }
  await deps.appSettings.upsert(actor.tenantId, {
    geminiReportModel: trimmedReport,
    geminiOcrModel: trimmedOcr,
  });
  await writeLog(deps, actor, 'SECURITY', 'settings.gemini_models.changed', {
    reportModel: trimmedReport,
    ocrModel: trimmedOcr,
  });
  return { ok: true, changed: true, message: 'モデル設定を保存しました。' };
}

/** GAS版saveGoogleChatWebhookSettingsForAdminと同じガード。 */
export async function saveGoogleChatWebhookSettings(
  deps: SettingsDeps,
  actor: SettingsActor,
  reportWebhookUrl: string,
  receiptWebhookUrl: string,
): Promise<SaveSettingsResult> {
  const trimmedReport = reportWebhookUrl.trim();
  const trimmedReceipt = receiptWebhookUrl.trim();
  if (!trimmedReport || !trimmedReceipt) {
    await writeLog(deps, actor, 'WARN', 'settings.gchat_webhooks.save_rejected', { reason: 'empty' });
    return {
      ok: false,
      reason: 'empty',
      message: 'Webhook URLが空です。空のまま保存すると既存の設定が失われるため、保存を中止しました。',
    };
  }
  const row = await deps.appSettings.find(actor.tenantId);
  const [currentReport, currentReceipt] = await Promise.all([
    decryptOrEmpty(deps, actor.tenantId, row?.gchatReportWebhookUrl ?? null),
    decryptOrEmpty(deps, actor.tenantId, row?.gchatReceiptWebhookUrl ?? null),
  ]);
  if (currentReport === trimmedReport && currentReceipt === trimmedReceipt) {
    return { ok: true, changed: false, message: 'Webhook URLは変更ありません。' };
  }
  const [reportEnc, receiptEnc] = await Promise.all([
    deps.crypto.encrypt(actor.tenantId, trimmedReport),
    deps.crypto.encrypt(actor.tenantId, trimmedReceipt),
  ]);
  await deps.appSettings.upsert(actor.tenantId, {
    gchatReportWebhookUrl: reportEnc,
    gchatReceiptWebhookUrl: receiptEnc,
  });
  await writeLog(deps, actor, 'SECURITY', 'settings.gchat_webhooks.changed');
  return { ok: true, changed: true, message: 'Webhook URLを保存しました。' };
}

export type ListGeminiModelsResult =
  | { ok: true; models: GeminiModelInfo[] }
  | { ok: false; reason: 'no_api_key' | 'api_error'; message: string };

/**
 * Gemini APIで使えるモデル一覧を取得する。GAS版listAvailableGeminiModelsForAdminに対応。
 * apiKeyOverrideが空なら保存済みのキーを使う(保存前の入力中キーでも確認できるようにするため)。
 */
export async function listGeminiModelsForAdmin(
  deps: SettingsDeps,
  actor: SettingsActor,
  apiKeyOverride: string | undefined,
): Promise<ListGeminiModelsResult> {
  let apiKey = apiKeyOverride?.trim() ?? '';
  if (!apiKey) {
    const row = await deps.appSettings.find(actor.tenantId);
    apiKey = await decryptOrEmpty(deps, actor.tenantId, row?.geminiApiKey ?? null);
  }
  if (!apiKey) {
    return {
      ok: false,
      reason: 'no_api_key',
      message: 'Gemini APIキーが設定されていません。先にAPIキーを入力してください。',
    };
  }
  try {
    const models = await deps.listGeminiModels(apiKey);
    await writeLog(deps, actor, 'INFO', 'settings.gemini_models.listed', { count: models.length });
    return { ok: true, models };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writeLog(deps, actor, 'ERROR', 'settings.gemini_models.list_failed', {
      error: message.slice(0, 300),
    });
    return { ok: false, reason: 'api_error', message };
  }
}
