import { SECRET_MASK_CHAR } from '@katahimo/shared';
import { DomainError, invalid } from '../domain/errors/domainError';
import type { TenantSecretName } from '../domain/model';
import { isGoogleChatWebhookUrl } from '../domain/notifications';
import { reportModelFamilyOf } from '../domain/reports/modelFallback';
import type { AiApiKeyVerification, AiApiKeyVerifierPort } from '../ports/ai';
import type { AppLogPort } from '../ports/appLog';
import type { SecretBoxPort } from '../ports/secretBox';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor } from './requestMeta';

/** テナントの秘密値(tenant_secrets)を読み書きする usecase の依存。 */
export interface TenantSecretDeps {
  uow: UnitOfWorkPort;
  secretBox: SecretBoxPort;
  /** 開けない秘密値を ERROR で記録する(値は記録しない)。 */
  appLog: AppLogPort;
}

export interface SettingsDeps extends TenantSecretDeps {
  /** 新しい Gemini API キーを保存する前に Gemini に問い合わせて確かめる。 */
  aiKeyVerifier: AiApiKeyVerifierPort;
}

/** 設定を操作した管理者(ログ記録用。権限確認はAPIルート側で済ませてから呼ぶ)。 */
export type SettingsActor = Actor;

/**
 * 保存済みの秘密値。`unreadable` は行はあるが開けないもの(SecretBox の鍵・プロバイダを変えた、暗号文が壊れた等)。
 * 開けない値は使えないため、読む側は未設定と同じく既定の設定に戻し、管理者が保存し直すと上書きされる。
 */
export type StoredSecret = { state: 'unset' } | { state: 'set'; value: string } | { state: 'unreadable' };

/** 使える値(未設定・開けないときは空文字)。 */
export function usableSecretValue(secret: StoredSecret): string {
  return secret.state === 'set' ? secret.value : '';
}

/**
 * テナントの秘密値を読む。暗号文は1トランザクションで読み、開封(本番は Cloud KMS の呼び出し)は
 * トランザクションの外で行う。開けない値は例外にせず `unreadable` として返し、ERROR `settings.secret.unreadable`
 * を記録する(1つが開けなくても、他の秘密値や画面・保存の処理は続ける)。
 */
export async function readTenantSecrets<N extends TenantSecretName>(
  deps: TenantSecretDeps,
  tenantId: string,
  names: readonly N[],
): Promise<Record<N, StoredSecret>> {
  const sealed = await deps.uow.run(tenantId, (r) => Promise.all(names.map((name) => r.secrets.get(name))));
  const values = await Promise.all(
    names.map(async (name, i): Promise<StoredSecret> => {
      const secret = sealed[i];
      if (!secret) return { state: 'unset' };
      try {
        return { state: 'set', value: await deps.secretBox.open(tenantId, name, secret.sealedValue) };
      } catch (e) {
        await deps.appLog.write({
          tenantId,
          level: 'ERROR',
          action: 'settings.secret.unreadable',
          actorStaffId: null,
          details: { name, error: e instanceof Error ? e.name : 'unknown' },
        });
        return { state: 'unreadable' };
      }
    }),
  );
  return Object.fromEntries(names.map((name, i) => [name, values[i]])) as Record<N, StoredSecret>;
}

/** テナントの秘密値の使える値を読む(未設定・開けないときは空文字)。 */
export async function readTenantSecret(
  deps: TenantSecretDeps,
  tenantId: string,
  name: TenantSecretName,
): Promise<string> {
  return usableSecretValue((await readTenantSecrets(deps, tenantId, [name]))[name]);
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

export interface AdminSettingsView {
  /** 伏せ字にした値(未設定なら空文字)。 */
  geminiApiKey: string;
  geminiApiKeySet: boolean;
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

type SecretInput = { kind: 'unchanged' } | { kind: 'new'; value: string } | { kind: 'partially_masked' };

/**
 * 秘密値の入力欄から送られた値を解釈する。省略・今の伏せ字そのままなら変更なし。伏せ字の一部だけを
 * 書き換えた値(伏せ字の文字を含むが今の伏せ字と違う)は、意図した値にならないため拒否する。
 * 今の値が開けないときは伏せ字が空文字なので、伏せ字を含まない値だけが新しい値になる。
 */
function resolveSecretInput(
  input: string | undefined,
  current: StoredSecret,
  mask: (value: string) => string,
): SecretInput {
  if (input === undefined) return { kind: 'unchanged' };
  const trimmed = input.trim();
  const currentMasked = mask(usableSecretValue(current));
  if (trimmed === currentMasked && currentMasked !== '') return { kind: 'unchanged' };
  if (trimmed.includes(SECRET_MASK_CHAR)) return { kind: 'partially_masked' };
  return { kind: 'new', value: trimmed };
}

const PARTIALLY_MASKED_MESSAGE =
  '伏せ字の一部だけを書き換えることはできません。値全体を入力し直してください。';

/**
 * 管理者設定画面用の現在値を返す。GAS版のgetGeminiApiKeyForAdmin/getGoogleChatWebhookSettingsForAdminを
 * まとめたもの(モデルは自動で選ぶので、GAS版 getGeminiModelSettingsForAdmin にあたる値は無い)。GAS版と違い、APIキー・Webhook URLは平文では
 * 返さず伏せ字にする(画面から漏れても使えないようにするため。「表示」を押しても伏せ字が見えるだけ)。
 * 開けない秘密値は設定済み・伏せ字は空文字で返す(管理者が値を入力し直して保存すると上書きされる)。
 */
export async function getAdminSettings(deps: SettingsDeps, actor: SettingsActor): Promise<AdminSettingsView> {
  const secrets = await readTenantSecrets(deps, actor.tenantId, [
    'gemini_api_key',
    'gchat_report_webhook',
    'gchat_receipt_webhook',
  ]);
  return {
    geminiApiKey: maskApiKey(usableSecretValue(secrets.gemini_api_key)),
    geminiApiKeySet: secrets.gemini_api_key.state !== 'unset',
    gchatReportWebhookUrl: maskWebhookUrl(usableSecretValue(secrets.gchat_report_webhook)),
    gchatReportWebhookUrlSet: secrets.gchat_report_webhook.state !== 'unset',
    gchatReceiptWebhookUrl: maskWebhookUrl(usableSecretValue(secrets.gchat_receipt_webhook)),
    gchatReceiptWebhookUrlSet: secrets.gchat_receipt_webhook.state !== 'unset',
  };
}

/** キーを断られた・日報に使うモデルが無いときの入力欄(リクエストの項目名)。 */
const GEMINI_API_KEY_FIELD = 'apiKey';

export const GEMINI_KEY_REJECTED_MESSAGE =
  'Gemini API キーを確認できませんでした。キーが正しいか確認して、入力し直してください(キーは保存していません)。';
export const GEMINI_KEY_NO_MODEL_MESSAGE =
  'この Gemini API キーでは、日報・事故報告に使うモデル(Gemini Flash / Flash-Lite)が使えません。キーを発行したプロジェクトで Gemini API が使えるか確認して、別のキーを入力してください(キーは保存していません)。';
export const GEMINI_KEY_UNVERIFIED_MESSAGE =
  'Gemini に接続できず、API キーを確認できませんでした(キーは保存していません)。しばらくしてから、もう一度保存してください。';

/**
 * 確認の結果を、保存を止める DomainError にする(問題が無ければ null)。
 * キーを断られた・日報に使うモデル(Flash / Flash-Lite 系)が一覧に1つも無い → 400(入力欄のエラー)。
 * つながらない・時間切れ・回数の上限 → 502(確かめられなかったので保存しない)。
 */
function verificationError(result: AiApiKeyVerification): { error: DomainError; reason: string } | null {
  if (result.ok) {
    if (result.models.some((name) => reportModelFamilyOf(name) !== null)) return null;
    return {
      reason: 'no_report_model',
      error: invalid(GEMINI_KEY_NO_MODEL_MESSAGE, { [GEMINI_API_KEY_FIELD]: GEMINI_KEY_NO_MODEL_MESSAGE }),
    };
  }
  if (result.reason === 'key_rejected') {
    return {
      reason: result.reason,
      error: invalid(GEMINI_KEY_REJECTED_MESSAGE, { [GEMINI_API_KEY_FIELD]: GEMINI_KEY_REJECTED_MESSAGE }),
    };
  }
  return {
    reason: result.reason,
    error: new DomainError('upstream_unavailable', GEMINI_KEY_UNVERIFIED_MESSAGE, undefined, result.reason),
  };
}

/**
 * Gemini APIキーを保存する。GAS版saveGeminiApiKeyForAdminと同じく、空文字での保存は既存キーの
 * 意図しない消失を防ぐため拒否し、同じ値・伏せ字のままの値なら何もしない。今の値が開けないときは入力された値で上書きする。
 *
 * GAS版と違い、新しいキーは保存の前に Gemini に問い合わせて確かめる(ListModels。誤ったキーに気づくのが日報の生成の
 * ときにならないように)。確かめられなかったときは何も保存せず、WARN `settings.gemini_key.verify_failed`(理由コード
 * だけ。キーは残さない)を残して DomainError を投げる(キーを断られた・モデルが無い → 400 validation_failed、
 * つながらない等 → 502 upstream_unavailable)。問い合わせはトランザクションの外で行う。
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
  const stored = (await readTenantSecrets(deps, actor.tenantId, ['gemini_api_key'])).gemini_api_key;
  const input = resolveSecretInput(trimmed, stored, maskApiKey);
  if (input.kind === 'partially_masked') {
    await writeLog(deps, actor, 'WARN', 'settings.gemini_api_key.save_rejected', {
      reason: 'partially_masked',
    });
    return { ok: false, reason: 'partially_masked', message: PARTIALLY_MASKED_MESSAGE };
  }
  // 今の値が開けないときは比べられないため、入力された値で上書きする
  if (input.kind === 'unchanged' || (stored.state === 'set' && input.value === stored.value)) {
    return { ok: true, changed: false, message: 'Gemini APIキーは変更ありません。' };
  }
  // 実装は例外を投げない約束だが、投げたときも「確かめられなかった」として保存しない
  const verification: AiApiKeyVerification = await deps.aiKeyVerifier
    .verifyApiKey(input.value)
    .catch(() => ({ ok: false, reason: 'unreachable' }) as const);
  const failure = verificationError(verification);
  if (failure) {
    await writeLog(deps, actor, 'WARN', 'settings.gemini_key.verify_failed', {
      reason: failure.reason,
      ...(!verification.ok && verification.httpStatus !== undefined
        ? { httpStatus: verification.httpStatus }
        : {}),
    });
    throw failure.error;
  }
  await writeTenantSecrets(deps, actor, { gemini_api_key: trimmed });
  await writeLog(deps, actor, 'SECURITY', 'settings.gemini_api_key.changed');
  return { ok: true, changed: true, message: 'Gemini APIキーを保存しました。' };
}

/**
 * GAS版saveGoogleChatWebhookSettingsForAdminと同じガード(どちらか一方でも空なら拒否、同じ値なら何もしない)。
 * 省略・伏せ字のままの項目は保存済みの値を使う。新しい値は Google Chat の Incoming Webhook URL だけを
 * 受け付ける(GAS版には無い検証。サーバーが任意のURLへ送信しないようにするため)。開けない保存済みの値は
 * 空として扱い、入力し直した値で上書きする。
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
    // 開けない値は空文字として扱う(入力し直さない限り「空」で拒否し、入力し直せば必ず上書きする)
    const currentReport = usableSecretValue(current.gchat_report_webhook);
    const currentReceipt = usableSecretValue(current.gchat_receipt_webhook);
    const reportInput = resolveSecretInput(reportWebhookUrl, current.gchat_report_webhook, maskWebhookUrl);
    const receiptInput = resolveSecretInput(receiptWebhookUrl, current.gchat_receipt_webhook, maskWebhookUrl);
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
