import type { CryptoPort } from '../ports/crypto';
import type { AppSettingsRepositoryPort } from '../ports/repositories';

export interface SettingsDeps {
  appSettings: AppSettingsRepositoryPort;
  crypto: CryptoPort;
}

/** GAS版GeminiReport.jsのGEMINI_MODEL_REPORT_DEFAULT/GEMINI_MODEL_OCR_DEFAULTと同じ値。 */
const DEFAULT_GEMINI_REPORT_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_OCR_MODEL = 'gemini-2.5-flash-lite';

export interface AdminSettingsView {
  geminiApiKey: string;
  geminiReportModel: string;
  geminiOcrModel: string;
  gchatReportWebhookUrl: string;
  gchatReceiptWebhookUrl: string;
}

/**
 * 管理者設定画面用の現在値を復号して返す。GAS版のgetGeminiApiKeyForAdmin/
 * getGeminiModelSettingsForAdmin/getGoogleChatWebhookSettingsForAdminをまとめたもの
 * (呼び出し元のAPIルートで管理者権限チェックを行う)。
 */
export async function getAdminSettings(deps: SettingsDeps, tenantId: string): Promise<AdminSettingsView> {
  const row = await deps.appSettings.find(tenantId);
  const [geminiApiKey, gchatReportWebhookUrl, gchatReceiptWebhookUrl] = await Promise.all([
    row?.geminiApiKey ? deps.crypto.decrypt(tenantId, row.geminiApiKey) : Promise.resolve(''),
    row?.gchatReportWebhookUrl
      ? deps.crypto.decrypt(tenantId, row.gchatReportWebhookUrl)
      : Promise.resolve(''),
    row?.gchatReceiptWebhookUrl
      ? deps.crypto.decrypt(tenantId, row.gchatReceiptWebhookUrl)
      : Promise.resolve(''),
  ]);
  return {
    geminiApiKey,
    geminiReportModel: row?.geminiReportModel || DEFAULT_GEMINI_REPORT_MODEL,
    geminiOcrModel: row?.geminiOcrModel || DEFAULT_GEMINI_OCR_MODEL,
    gchatReportWebhookUrl,
    gchatReceiptWebhookUrl,
  };
}

export type SaveSettingsResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Gemini APIキーを保存する。空文字での保存は既存キーの意図しない消失を防ぐため拒否する
 * (GAS版saveGeminiApiKeyForAdminと同じガード)。
 */
export async function saveGeminiApiKey(
  deps: SettingsDeps,
  tenantId: string,
  apiKey: string,
): Promise<SaveSettingsResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: 'APIキーが空です。空のまま保存すると既存のキーが失われるため、保存を中止しました。',
    };
  }
  const encrypted = await deps.crypto.encrypt(tenantId, trimmed);
  await deps.appSettings.upsert(tenantId, { geminiApiKey: encrypted });
  return { ok: true, message: 'Gemini APIキーを保存しました。' };
}

/** どちらか一方でも空文字での保存は拒否する(GAS版saveGeminiModelSettingsForAdminと同じガード)。 */
export async function saveGeminiModelSettings(
  deps: SettingsDeps,
  tenantId: string,
  reportModel: string,
  ocrModel: string,
): Promise<SaveSettingsResult> {
  const trimmedReport = reportModel.trim();
  const trimmedOcr = ocrModel.trim();
  if (!trimmedReport || !trimmedOcr) {
    return {
      ok: false,
      message: 'モデルが未選択です。空のまま保存すると既存の設定が失われるため、保存を中止しました。',
    };
  }
  await deps.appSettings.upsert(tenantId, { geminiReportModel: trimmedReport, geminiOcrModel: trimmedOcr });
  return { ok: true, message: 'モデル設定を保存しました。' };
}

/** どちらか一方でも空文字での保存は拒否する(GAS版saveGoogleChatWebhookSettingsForAdminと同じガード)。 */
export async function saveGoogleChatWebhookSettings(
  deps: SettingsDeps,
  tenantId: string,
  reportWebhookUrl: string,
  receiptWebhookUrl: string,
): Promise<SaveSettingsResult> {
  const trimmedReport = reportWebhookUrl.trim();
  const trimmedReceipt = receiptWebhookUrl.trim();
  if (!trimmedReport || !trimmedReceipt) {
    return {
      ok: false,
      message: 'Webhook URLが空です。空のまま保存すると既存の設定が失われるため、保存を中止しました。',
    };
  }
  const [reportEnc, receiptEnc] = await Promise.all([
    deps.crypto.encrypt(tenantId, trimmedReport),
    deps.crypto.encrypt(tenantId, trimmedReceipt),
  ]);
  await deps.appSettings.upsert(tenantId, {
    gchatReportWebhookUrl: reportEnc,
    gchatReceiptWebhookUrl: receiptEnc,
  });
  return { ok: true, message: 'Webhook URLを保存しました。' };
}
