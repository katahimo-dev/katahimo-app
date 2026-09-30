import { beforeEach, describe, expect, it } from 'vitest';
import { isDomainError } from '../domain/errors/domainError';
import type { TenantSecretName } from '../domain/model';
import type { AiApiKeyVerification, ReportAiPort } from '../ports/ai';
import { notifyWithLog } from './notify';
import type { ReportAiDeps } from './reportAi';
import { generateDailyReportDraft } from './reportAi';
import type { SettingsActor, SettingsDeps } from './settings';
import {
  GEMINI_KEY_NO_MODEL_MESSAGE,
  GEMINI_KEY_REJECTED_MESSAGE,
  GEMINI_KEY_UNVERIFIED_MESSAGE,
  getAdminSettings,
  saveGeminiApiKey,
  saveGoogleChatWebhookSettings,
} from './settings';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';
import type { FakeAppLogPort } from './testDoubles';

describe('管理者設定(app_settings)', () => {
  let deps: SettingsDeps;
  let appLog: FakeAppLogPort;
  let ctx: TestContext;
  let actor: SettingsActor;
  let otherTenantId: string;
  /** Gemini での確認の結果(既定は使えるキー)と、確認したキー。 */
  let verification: AiApiKeyVerification;
  let verifiedKeys: string[];

  beforeEach(() => {
    verification = { ok: true, models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] };
    verifiedKeys = [];
    ctx = createTestContext();
    otherTenantId = ctx.db.addTenant({ slug: 'other' }).id;
    actor = { tenantId: ctx.tenantId, staffId: '00000000-0000-7000-8000-0000000000aa', role: 'admin' };
    appLog = ctx.appLog;
    deps = {
      uow: ctx.uow,
      secretBox: ctx.secretBox,
      appLog,
      aiKeyVerifier: {
        async verifyApiKey(apiKey) {
          verifiedKeys.push(apiKey);
          return verification;
        },
      },
    };
  });

  /** 保存済みの値(tenant_secrets の暗号文を開いたもの)。 */
  const stored = async (tenantId = actor.tenantId) => {
    const plain = (name: TenantSecretName) => {
      const secret = ctx.data(tenantId).secrets.find((s) => s.name === name);
      return secret
        ? Buffer.from(secret.sealedValue).toString('utf8').replace(`SEALED|${tenantId}|${name}|`, '')
        : '';
    };
    return {
      geminiApiKey: plain('gemini_api_key'),
      report: plain('gchat_report_webhook'),
      receipt: plain('gchat_receipt_webhook'),
    };
  };
  const REPORT_URL = 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k1&token=t1';
  const RECEIPT_URL = 'https://chat.googleapis.com/v1/spaces/BBBB/messages?key=k2&token=t2';

  it('未設定時はGemini APIキー/Webhook URLが空文字(未設定)を返す(モデルは自動で選ぶので設定は無い)', async () => {
    expect(await getAdminSettings(deps, actor)).toEqual({
      geminiApiKey: '',
      geminiApiKeySet: false,
      gchatReportWebhookUrl: '',
      gchatReportWebhookUrlSet: false,
      gchatReceiptWebhookUrl: '',
      gchatReceiptWebhookUrlSet: false,
    });
  });

  it('APIキー・Webhook URLは平文では返さず、伏せ字と設定済みフラグだけを返す', async () => {
    await saveGeminiApiKey(deps, actor, 'AIzaSyExampleKey1234');
    await saveGoogleChatWebhookSettings(deps, actor, REPORT_URL, RECEIPT_URL);
    const view = await getAdminSettings(deps, actor);
    expect(view).toMatchObject({
      geminiApiKey: '••••••••1234',
      geminiApiKeySet: true,
      gchatReportWebhookUrl: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?••••••••',
      gchatReportWebhookUrlSet: true,
      gchatReceiptWebhookUrlSet: true,
    });
    expect(JSON.stringify(view)).not.toMatch(/AIzaSyExample|k1|t1|k2|t2/);
  });

  it('Gemini APIキーを保存すると暗号化して保存され、変更はSECURITYログに残る', async () => {
    expect(await saveGeminiApiKey(deps, actor, 'sk-test-key')).toMatchObject({ ok: true, changed: true });
    expect((await stored()).geminiApiKey).toBe('sk-test-key');
    expect(appLog.actions()).toContain('settings.gemini_api_key.changed');
  });

  describe('新しいAPIキーは保存の前に Gemini で確かめる', () => {
    /** 投げられた DomainError(投げなければ失敗)。 */
    const rejection = async (apiKey: string) => {
      const error = await saveGeminiApiKey(deps, actor, apiKey).then(
        () => null,
        (e: unknown) => e,
      );
      if (!isDomainError(error)) throw new Error('DomainError が投げられていない');
      return error;
    };

    it('使えるキーなら(前後の空白を除いた値で)確かめてから保存する', async () => {
      expect(await saveGeminiApiKey(deps, actor, ' AIza-valid-key ')).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(verifiedKeys).toEqual(['AIza-valid-key']);
      expect((await stored()).geminiApiKey).toBe('AIza-valid-key');
      expect(appLog.actions()).not.toContain('settings.gemini_key.verify_failed');
    });

    it('キーを断られたら 400(入力欄のエラー)で、何も保存せず理由コードだけを WARN に残す', async () => {
      await saveGeminiApiKey(deps, actor, 'AIza-old-key');
      verification = { ok: false, reason: 'key_rejected', httpStatus: 400 };
      const error = await rejection('AIza-wrong-key');
      expect(error).toMatchObject({
        code: 'validation_failed',
        message: GEMINI_KEY_REJECTED_MESSAGE,
        fields: { apiKey: GEMINI_KEY_REJECTED_MESSAGE },
      });
      expect((await stored()).geminiApiKey).toBe('AIza-old-key');
      const log = appLog.entries.at(-1);
      expect(log).toMatchObject({
        level: 'WARN',
        action: 'settings.gemini_key.verify_failed',
        details: { reason: 'key_rejected', httpStatus: 400 },
      });
      expect(JSON.stringify(appLog.entries)).not.toContain('AIza-wrong-key');
      expect(appLog.actions().filter((a) => a === 'settings.gemini_api_key.changed')).toHaveLength(1);
    });

    it('一覧に日報に使うモデル(Flash / Flash-Lite)が無ければ、モデルの文言で 400 にして保存しない', async () => {
      verification = { ok: true, models: ['gemini-embedding-001', 'gemini-2.5-pro'] };
      expect(await rejection('AIza-no-flash')).toMatchObject({
        code: 'validation_failed',
        message: GEMINI_KEY_NO_MODEL_MESSAGE,
        fields: { apiKey: GEMINI_KEY_NO_MODEL_MESSAGE },
      });
      expect((await stored()).geminiApiKey).toBe('');
      expect(appLog.entries.at(-1)).toMatchObject({ details: { reason: 'no_report_model' } });
    });

    it.each([
      { reason: 'unreachable', httpStatus: 503 },
      { reason: 'timeout' },
      { reason: 'rate_limited', httpStatus: 429 },
    ] as const)('Gemini で確かめられない($reason)ときは 502 にして保存しない', async (failure) => {
      verification = { ok: false, ...failure };
      const error = await rejection('AIza-maybe-valid');
      expect(error).toMatchObject({ code: 'upstream_unavailable', message: GEMINI_KEY_UNVERIFIED_MESSAGE });
      expect(error.fields).toBeUndefined();
      expect((await stored()).geminiApiKey).toBe('');
      expect(appLog.entries.at(-1)).toMatchObject({
        level: 'WARN',
        action: 'settings.gemini_key.verify_failed',
        details: { reason: failure.reason },
      });
    });

    it('確認が例外を投げても、確かめられなかったとして保存しない', async () => {
      deps.aiKeyVerifier = {
        verifyApiKey: async () => {
          throw new Error('boom');
        },
      };
      expect((await rejection('AIza-throw')).code).toBe('upstream_unavailable');
      expect((await stored()).geminiApiKey).toBe('');
    });

    it('変更の無い値・伏せ字のまま・空・伏せ字の一部の書き換えは確かめない', async () => {
      await saveGeminiApiKey(deps, actor, 'AIza-current-1234');
      verifiedKeys = [];
      const masked = (await getAdminSettings(deps, actor)).geminiApiKey;
      await saveGeminiApiKey(deps, actor, masked);
      await saveGeminiApiKey(deps, actor, 'AIza-current-1234');
      await saveGeminiApiKey(deps, actor, '  ');
      await saveGeminiApiKey(deps, actor, `x${masked}`);
      expect(verifiedKeys).toEqual([]);
    });
  });

  it('伏せ字のままのAPIキーを保存しても変更しない(画面の初期値をそのまま保存した場合)', async () => {
    await saveGeminiApiKey(deps, actor, 'sk-test-key-0001');
    const masked = (await getAdminSettings(deps, actor)).geminiApiKey;
    expect(await saveGeminiApiKey(deps, actor, masked)).toMatchObject({ ok: true, changed: false });
    expect((await stored()).geminiApiKey).toBe('sk-test-key-0001');
  });

  it('同じAPIキーを保存し直しても「変更ありません」となりログも増えない', async () => {
    await saveGeminiApiKey(deps, actor, 'sk-test-key');
    const before = appLog.entries.length;
    expect(await saveGeminiApiKey(deps, actor, ' sk-test-key ')).toEqual({
      ok: true,
      changed: false,
      message: 'Gemini APIキーは変更ありません。',
    });
    expect(appLog.entries.length).toBe(before);
  });

  it('空文字でのGemini APIキー保存は拒否され(WARNログ)、既存の値が保持される', async () => {
    await saveGeminiApiKey(deps, actor, 'sk-existing');
    expect((await saveGeminiApiKey(deps, actor, '   ')).ok).toBe(false);
    expect(appLog.entries.at(-1)).toMatchObject({
      level: 'WARN',
      action: 'settings.gemini_api_key.save_rejected',
    });
    expect((await stored()).geminiApiKey).toBe('sk-existing');
  });

  it('Webhook URLを保存できる。どちらか一方でも空なら拒否される', async () => {
    const result = await saveGoogleChatWebhookSettings(deps, actor, REPORT_URL, RECEIPT_URL);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect((await saveGoogleChatWebhookSettings(deps, actor, '', RECEIPT_URL)).ok).toBe(false);
    expect(await stored()).toMatchObject({ report: REPORT_URL, receipt: RECEIPT_URL });
    expect(appLog.actions()).toContain('settings.gchat_webhooks.changed');
  });

  it('Webhook URLは省略・伏せ字のままの項目を保存済みの値のまま残し、変更した項目だけ更新する', async () => {
    await saveGoogleChatWebhookSettings(deps, actor, REPORT_URL, RECEIPT_URL);
    const view = await getAdminSettings(deps, actor);
    const newReceipt = 'https://chat.googleapis.com/v1/spaces/CCCC/messages?key=k3&token=t3';
    expect(
      await saveGoogleChatWebhookSettings(deps, actor, view.gchatReportWebhookUrl, newReceipt),
    ).toMatchObject({ ok: true, changed: true });
    expect(await stored()).toMatchObject({ report: REPORT_URL, receipt: newReceipt });
    expect(await saveGoogleChatWebhookSettings(deps, actor, undefined, undefined)).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it('伏せ字の一部だけを書き換えた値は保存せずに拒否する(意図した値にならないため)', async () => {
    await saveGeminiApiKey(deps, actor, 'sk-test-key-0001');
    const masked = (await getAdminSettings(deps, actor)).geminiApiKey;
    expect(await saveGeminiApiKey(deps, actor, `${masked}9`)).toMatchObject({
      ok: false,
      reason: 'partially_masked',
    });
    expect((await stored()).geminiApiKey).toBe('sk-test-key-0001');
  });

  it('Google Chat 以外のURLは保存しない(SSRF対策、WARNログ)', async () => {
    const result = await saveGoogleChatWebhookSettings(
      deps,
      actor,
      'http://169.254.169.254/computeMetadata/v1/',
      RECEIPT_URL,
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_url' });
    expect(appLog.entries.at(-1)).toMatchObject({
      level: 'WARN',
      action: 'settings.gchat_webhooks.save_rejected',
      details: { reason: 'invalid_url', channels: ['report'] },
    });
    expect((await stored()).report).toBe('');
  });

  it('別テナントの設定は互いに影響しない', async () => {
    await saveGeminiApiKey(deps, actor, 'key-1');
    await saveGeminiApiKey(deps, { ...actor, tenantId: otherTenantId }, 'key-2');
    expect((await stored()).geminiApiKey).toBe('key-1');
  });

  describe('保存済みの秘密値が開けないとき(SecretBox の鍵・プロバイダを変えた等)', () => {
    beforeEach(async () => {
      await saveGeminiApiKey(deps, actor, 'AIzaSyExampleKey1234');
      await saveGoogleChatWebhookSettings(deps, actor, REPORT_URL, RECEIPT_URL);
      ctx.secretBox.failOpen = true;
    });
    const unreadableLogs = () => appLog.entries.filter((e) => e.action === 'settings.secret.unreadable');

    it('設定画面は開け、設定済み・伏せ字は空で返し、ERRORログに名前だけを残す(値は残さない)', async () => {
      expect(await getAdminSettings(deps, actor)).toMatchObject({
        geminiApiKey: '',
        geminiApiKeySet: true,
        gchatReportWebhookUrl: '',
        gchatReportWebhookUrlSet: true,
        gchatReceiptWebhookUrl: '',
        gchatReceiptWebhookUrlSet: true,
      });
      expect(unreadableLogs().map((e) => [e.level, e.details?.name])).toEqual([
        ['ERROR', 'gemini_api_key'],
        ['ERROR', 'gchat_report_webhook'],
        ['ERROR', 'gchat_receipt_webhook'],
      ]);
      expect(JSON.stringify(appLog.entries)).not.toContain('AIzaSyExampleKey1234');
    });

    it('APIキーは入力し直した値で上書きできる(同じ値でも比べずに保存する)', async () => {
      expect(await saveGeminiApiKey(deps, actor, 'AIzaSyExampleKey1234')).toMatchObject({
        ok: true,
        changed: true,
      });
      ctx.secretBox.failOpen = false;
      expect((await stored()).geminiApiKey).toBe('AIzaSyExampleKey1234');
    });

    it('APIキーの伏せ字を送っても開けない値は残せない(一部伏せ字として拒否)', async () => {
      expect(await saveGeminiApiKey(deps, actor, '••••••••1234')).toMatchObject({
        ok: false,
        reason: 'partially_masked',
      });
    });

    it('Webhook URLは入力し直した方だけ上書きし、入力し直さなければ空として拒否する', async () => {
      const NEW_REPORT = 'https://chat.googleapis.com/v1/spaces/CCCC/messages?key=k3&token=t3';
      expect(await saveGoogleChatWebhookSettings(deps, actor, NEW_REPORT, undefined)).toMatchObject({
        ok: false,
        reason: 'empty',
      });
      expect(await saveGoogleChatWebhookSettings(deps, actor, NEW_REPORT, RECEIPT_URL)).toMatchObject({
        ok: true,
        changed: true,
      });
      ctx.secretBox.failOpen = false;
      expect(await stored()).toMatchObject({ report: NEW_REPORT, receipt: RECEIPT_URL });
    });

    it('AIの下書きは .env の設定(deps.reportAi)に戻す', async () => {
      const used: string[] = [];
      const portOf = (label: string): ReportAiPort => ({
        hasApiKey: true,
        async generateDailyReport() {
          used.push(label);
          return { warnings: [], internal: '', customer: '' };
        },
        async generateAccidentReport() {
          return { error: 'unused' };
        },
        async extractReceiptAmount() {
          return { amount: '', storeName: '', receiptDate: '' };
        },
      });
      const aiDeps: ReportAiDeps = {
        uow: ctx.uow,
        secretBox: ctx.secretBox,
        appLog,
        reportAi: portOf('env'),
        reportAiFactory: { create: () => portOf('tenant') },
      };
      const customerId = await ctx.addCustomer('田中 花子');
      await generateDailyReportDraft(aiDeps, actor, { text: 'メモ', customerId });
      ctx.secretBox.failOpen = false;
      await generateDailyReportDraft(aiDeps, actor, { text: 'メモ', customerId });
      expect(used).toEqual(['env', 'tenant']);
    });

    it('通知の送信先を解決できなくても日報の保存は失敗させない(通知の失敗をログに残す)', async () => {
      ctx.deps.notifier.notify = async () => {
        throw new Error('resolve failed');
      };
      await expect(
        notifyWithLog(ctx.deps, actor.tenantId, 'report', '本文', actor.staffId),
      ).resolves.toBeUndefined();
      expect(appLog.entries.at(-1)).toMatchObject({
        level: 'ERROR',
        action: 'notification.gchat.failed',
        details: { channel: 'report', error: 'notifier_error' },
      });
    });
  });
});
