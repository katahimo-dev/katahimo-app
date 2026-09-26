import { SECRET_MASK_CHAR } from '@katahimo/shared';
import type { TenantSecretName } from '../domain/model';
import { isGoogleChatWebhookUrl } from '../domain/notifications';
import type { AppLogPort } from '../ports/appLog';
import type { SecretBoxPort } from '../ports/secretBox';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor } from './requestMeta';

export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

/** テナントの秘密値(tenant_secrets)を読み書きする usecase の依存。 */
export interface TenantSecretDeps {
  uow: UnitOfWorkPort;
  secretBox: SecretBoxPort;
}

export interface SettingsDeps extends TenantSecretDeps {
  appLog: AppLogPort;
  /** Gemini ListModels(@katahimo/integrationsのlistAvailableGeminiModels)。失敗時は例外を投げる。 */
  listGeminiModels: (apiKey: string) => Promise<GeminiModelInfo[]>;
}

/** 設定を操作した管理者(ログ記録用。権限確認はAPIルート側で済ませてから呼ぶ)。 */
export type SettingsActor = Actor;

/**
 * テナントの秘密値を読む(無ければ空文字)。暗号文は1トランザクションで読み、開封(本番は Cloud KMS の呼び出し)は
 * トランザクションの外で行う。
 */
export async function readTenantSecrets<N extends TenantSecretName>(
  deps: TenantSecretDeps,
  tenantId: string,
  names: readonly N[],
): Promise<Record<N, string>> {
  const sealed = await deps.uow.run(tenantId, (r) => Promise.all(names.map((name) => r.secrets.get(name))));
  const values = await Promise.all(
    names.map((name, i) => {
      const secret = sealed[i];
      return secret ? deps.secretBox.open(tenantId, name, secret.sealedValue) : '';
    }),
  );
  return Object.fromEntries(names.map((name, i) => [name, values[i]])) as Record<N, string>;
}

export async function readTenantSecret(
  deps: TenantSecretDeps,
  tenantId: string,
  name: TenantSecretName,
): Promise<string> {
  return (await readTenantSecrets(deps, tenantId, [name]))[name];
}

/** 秘密値を封をして保存する(封はトランザクションの外、書き込みは1トランザクション)。 */
async function writeTenantSecrets(
  deps: TenantSecretDeps,
  actor: SettingsActor,
  values: Partial<Record<TenantSecretName, string>>,
): Promise<void> {
  const entries = Object.entries(values) as [TenantSecretName, string][];
  const sealed = await Promise.all(
    entries.map(
      async ([name, value]) => [name, await deps.secretBox.seal(actor.tenantId, name, value)] as const,
    ),
  );
  await deps.uow.run(actor.tenantId, async (r) => {
    for (const [name, value] of sealed) await r.secrets.put(name, value, actor.staffId);
  });
}

/** GAS版GeminiReport.jsのGEMINI_MODEL_REPORT_DEFAULT/GEMINI_MODEL_OCR_DEFAULTと同じ値。 */
export const DEFAULT_GEMINI_REPORT_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_OCR_MODEL = 'gemini-2.5-flash-lite';

export interface AdminSettingsView {
  /** 伏せ字にした値(未設定なら空文字)。 */
  geminiApiKey: string;
  geminiApiKeySet: boolean;
  geminiReportModel: string;
  geminiOcrModel: string;
  gchatReportWebhookUrl: string;
  gchatReportWebhookUrlSet: boolean;
  gchatReceiptWebhookUrl: string;
  gchatReceiptWebhookUrlSet: boolean;
}

export type SaveSettingsResult =
  | { ok: true; changed: boolean; message: string }
  | { ok: false; reason: 'empty' | 'invalid_url' | 'partially_masked'; message: string };

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

const MASK = SECRET_MASK_CHAR.repeat(8);

/** APIキーを伏せ字にする(末尾4文字だけ残す。短いキーは全部伏せる)。 */
export function maskApiKey(value: string): string {
  if (!value) return '';
  return value.length > 8 ? `${MASK}${value.slice(-4)}` : MASK;
}

/** Webhook URLを伏せ字にする(スペースのパスまで残し、key/token のクエリは伏せる)。 */
export function maskWebhookUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}?${MASK}`;
  } catch {
    return MASK;
  }
}

/** 画面から送られた値が伏せ字を含むか(伏せ字のまま=変更しない、の判定に使う)。 */
function isMaskedInput(value: string | undefined): boolean {
  return value === undefined || value.includes(SECRET_MASK_CHAR);
}

type SecretInput = { kind: 'unchanged' } | { kind: 'new'; value: string } | { kind: 'partially_masked' };

/**
 * 秘密値の入力欄から送られた値を解釈する。省略・今の伏せ字そのままなら変更なし。伏せ字の一部だけを
 * 書き換えた値(伏せ字の文字を含むが今の伏せ字と違う)は、意図した値にならないため拒否する。
 */
function resolveSecretInput(input: string | undefined, currentMasked: string): SecretInput {
  if (input === undefined) return { kind: 'unchanged' };
  const trimmed = input.trim();
  if (trimmed === currentMasked && currentMasked !== '') return { kind: 'unchanged' };
  if (trimmed.includes(SECRET_MASK_CHAR)) return { kind: 'partially_masked' };
  return { kind: 'new', value: trimmed };
}

const PARTIALLY_MASKED_MESSAGE =
  '伏せ字の一部だけを書き換えることはできません。値全体を入力し直してください。';

/**
 * 管理者設定画面用の現在値を返す。GAS版のgetGeminiApiKeyForAdmin/getGeminiModelSettingsForAdmin/
 * getGoogleChatWebhookSettingsForAdminをまとめたもの。GAS版と違い、APIキー・Webhook URLは平文では
 * 返さず伏せ字にする(画面から漏れても使えないようにするため。「表示」を押しても伏せ字が見えるだけ)。
 */
export async function getAdminSettings(deps: SettingsDeps, actor: SettingsActor): Promise<AdminSettingsView> {
  const [row, secrets] = await Promise.all([
    deps.uow.run(actor.tenantId, (r) => r.settings.get()),
    readTenantSecrets(deps, actor.tenantId, [
      'gemini_api_key',
      'gchat_report_webhook',
      'gchat_receipt_webhook',
    ]),
  ]);
  const geminiApiKey = secrets.gemini_api_key;
  const gchatReportWebhookUrl = secrets.gchat_report_webhook;
  const gchatReceiptWebhookUrl = secrets.gchat_receipt_webhook;
  return {
    geminiApiKey: maskApiKey(geminiApiKey),
    geminiApiKeySet: geminiApiKey !== '',
    geminiReportModel: row.geminiReportModel || DEFAULT_GEMINI_REPORT_MODEL,
    geminiOcrModel: row.geminiOcrModel || DEFAULT_GEMINI_OCR_MODEL,
    gchatReportWebhookUrl: maskWebhookUrl(gchatReportWebhookUrl),
    gchatReportWebhookUrlSet: gchatReportWebhookUrl !== '',
    gchatReceiptWebhookUrl: maskWebhookUrl(gchatReceiptWebhookUrl),
    gchatReceiptWebhookUrlSet: gchatReceiptWebhookUrl !== '',
  };
}

/**
 * Gemini APIキーを保存する。GAS版saveGeminiApiKeyForAdminと同じく、空文字での保存は既存キーの
 * 意図しない消失を防ぐため拒否し、同じ値・伏せ字のままの値なら何もしない。
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
  const current = await readTenantSecret(deps, actor.tenantId, 'gemini_api_key');
  const input = resolveSecretInput(trimmed, maskApiKey(current));
  if (input.kind === 'partially_masked') {
    await writeLog(deps, actor, 'WARN', 'settings.gemini_api_key.save_rejected', {
      reason: 'partially_masked',
    });
    return { ok: false, reason: 'partially_masked', message: PARTIALLY_MASKED_MESSAGE };
  }
  if (input.kind === 'unchanged' || input.value === current) {
    return { ok: true, changed: false, message: 'Gemini APIキーは変更ありません。' };
  }
  await writeTenantSecrets(deps, actor, { gemini_api_key: trimmed });
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
  const changed = await deps.uow.run(actor.tenantId, async (r) => {
    const row = await r.settings.get();
    const currentReport = row.geminiReportModel || DEFAULT_GEMINI_REPORT_MODEL;
    const currentOcr = row.geminiOcrModel || DEFAULT_GEMINI_OCR_MODEL;
    if (currentReport === trimmedReport && currentOcr === trimmedOcr) return false;
    await r.settings.update({ geminiReportModel: trimmedReport, geminiOcrModel: trimmedOcr });
    return true;
  });
  if (!changed) return { ok: true, changed: false, message: 'モデル設定は変更ありません。' };
  await writeLog(deps, actor, 'SECURITY', 'settings.gemini_models.changed', {
    reportModel: trimmedReport,
    ocrModel: trimmedOcr,
  });
  return { ok: true, changed: true, message: 'モデル設定を保存しました。' };
}

/**
 * GAS版saveGoogleChatWebhookSettingsForAdminと同じガード(どちらか一方でも空なら拒否、同じ値なら何もしない)。
 * 省略・伏せ字のままの項目は保存済みの値を使う。新しい値は Google Chat の Incoming Webhook URL だけを
 * 受け付ける(GAS版には無い検証。サーバーが任意のURLへ送信しないようにするため)。
 */
export async function saveGoogleChatWebhookSettings(
  deps: SettingsDeps,
  actor: SettingsActor,
  reportWebhookUrl: string | undefined,
  receiptWebhookUrl: string | undefined,
): Promise<SaveSettingsResult> {
  let invalidChannels: string[] = [];
  const current = await readTenantSecrets(deps, actor.tenantId, [
    'gchat_report_webhook',
    'gchat_receipt_webhook',
  ]);
  const result = ((): SaveSettingsResult | Partial<Record<TenantSecretName, string>> => {
    const currentReport = current.gchat_report_webhook;
    const currentReceipt = current.gchat_receipt_webhook;
    const reportInput = resolveSecretInput(reportWebhookUrl, maskWebhookUrl(currentReport));
    const receiptInput = resolveSecretInput(receiptWebhookUrl, maskWebhookUrl(currentReceipt));
    if (reportInput.kind === 'partially_masked' || receiptInput.kind === 'partially_masked') {
      return { ok: false, reason: 'partially_masked', message: PARTIALLY_MASKED_MESSAGE };
    }
    const nextReport = reportInput.kind === 'new' ? reportInput.value : currentReport;
    const nextReceipt = receiptInput.kind === 'new' ? receiptInput.value : currentReceipt;
    if (!nextReport || !nextReceipt) {
      return {
        ok: false,
        reason: 'empty',
        message: 'Webhook URLが空です。空のまま保存すると既存の設定が失われるため、保存を中止しました。',
      };
    }
    if (currentReport === nextReport && currentReceipt === nextReceipt) {
      return { ok: true, changed: false, message: 'Webhook URLは変更ありません。' };
    }
    const invalid = [
      nextReport !== currentReport && !isGoogleChatWebhookUrl(nextReport) ? 'report' : null,
      nextReceipt !== currentReceipt && !isGoogleChatWebhookUrl(nextReceipt) ? 'receipt' : null,
    ].filter((v) => v !== null);
    if (invalid.length > 0) {
      invalidChannels = invalid;
      return {
        ok: false,
        reason: 'invalid_url',
        message:
          'Webhook URLが正しくありません。Google Chat の Webhook URL(https://chat.googleapis.com/v1/spaces/...)を入力してください。',
      };
    }
    return {
      ...(nextReport !== currentReport ? { gchat_report_webhook: nextReport } : {}),
      ...(nextReceipt !== currentReceipt ? { gchat_receipt_webhook: nextReceipt } : {}),
    };
  })();
  if ('ok' in result) {
    if (!result.ok) {
      await writeLog(deps, actor, 'WARN', 'settings.gchat_webhooks.save_rejected', {
        reason: result.reason,
        ...(invalidChannels.length > 0 ? { channels: invalidChannels } : {}),
      });
    }
    return result;
  }
  await writeTenantSecrets(deps, actor, result);
  await writeLog(deps, actor, 'SECURITY', 'settings.gchat_webhooks.changed');
  return { ok: true, changed: true, message: 'Webhook URLを保存しました。' };
}

export type ListGeminiModelsResult =
  | { ok: true; models: GeminiModelInfo[] }
  | { ok: false; reason: 'no_api_key' | 'api_error'; message: string };

/**
 * Gemini APIで使えるモデル一覧を取得する。GAS版listAvailableGeminiModelsForAdminに対応。
 * apiKeyOverrideが空・伏せ字のままなら保存済みのキーを使う(保存前の入力中キーでも確認できるようにするため)。
 */
export async function listGeminiModelsForAdmin(
  deps: SettingsDeps,
  actor: SettingsActor,
  apiKeyOverride: string | undefined,
): Promise<ListGeminiModelsResult> {
  let apiKey = apiKeyOverride?.trim() ?? '';
  if (!apiKey || isMaskedInput(apiKey)) {
    apiKey = await readTenantSecret(deps, actor.tenantId, 'gemini_api_key');
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
