import { beforeEach, describe, expect, it } from 'vitest';
import type { SettingsActor, SettingsDeps } from './settings';
import {
  getAdminSettings,
  listGeminiModelsForAdmin,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
} from './settings';
import { FakeAppLogPort, FakeAppSettingsRepository, FakeCryptoPort } from './testDoubles';

describe('管理者設定(app_settings)', () => {
  let deps: SettingsDeps;
  let appLog: FakeAppLogPort;
  let listedWith: string[];
  const actor: SettingsActor = { tenantId: 'tenant-1', staffId: 'admin-1' };

  beforeEach(() => {
    appLog = new FakeAppLogPort();
    listedWith = [];
    deps = {
      appSettings: new FakeAppSettingsRepository(),
      crypto: new FakeCryptoPort(),
      appLog,
      listGeminiModels: async (apiKey) => {
        listedWith.push(apiKey);
        return [{ name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }];
      },
    };
  });

  it('未設定時はGemini APIキー/Webhook URLが空文字、モデルはデフォルト値を返す', async () => {
    expect(await getAdminSettings(deps, actor)).toEqual({
      geminiApiKey: '',
      geminiReportModel: 'gemini-2.5-flash',
      geminiOcrModel: 'gemini-2.5-flash-lite',
      gchatReportWebhookUrl: '',
      gchatReceiptWebhookUrl: '',
    });
  });

  it('設定の閲覧(復号したAPIキー/Webhook URLを返す)はSECURITYログに残る', async () => {
    await getAdminSettings(deps, actor);
    expect(appLog.entries).toEqual([
      expect.objectContaining({
        level: 'SECURITY',
        action: 'settings.secrets.viewed',
        actorStaffId: 'admin-1',
      }),
    ]);
  });

  it('Gemini APIキーを保存すると復号して取得でき、変更はSECURITYログに残る', async () => {
    expect(await saveGeminiApiKey(deps, actor, 'sk-test-key')).toMatchObject({ ok: true, changed: true });
    expect((await getAdminSettings(deps, actor)).geminiApiKey).toBe('sk-test-key');
    expect(appLog.actions()).toContain('settings.gemini_api_key.changed');
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
    expect((await getAdminSettings(deps, actor)).geminiApiKey).toBe('sk-existing');
  });

  it('モデル設定を保存できる。どちらか一方でも空なら拒否される', async () => {
    expect((await saveGeminiModelSettings(deps, actor, 'gemini-3.0-pro', 'gemini-3.0-flash')).ok).toBe(true);
    expect((await saveGeminiModelSettings(deps, actor, '', 'gemini-3.0-flash')).ok).toBe(false);
    expect(await getAdminSettings(deps, actor)).toMatchObject({
      geminiReportModel: 'gemini-3.0-pro',
      geminiOcrModel: 'gemini-3.0-flash',
    });
    expect(appLog.actions()).toContain('settings.gemini_models.changed');
  });

  it('Webhook URLを保存できる。どちらか一方でも空なら拒否される', async () => {
    const result = await saveGoogleChatWebhookSettings(
      deps,
      actor,
      'https://chat/report',
      'https://chat/receipt',
    );
    expect(result).toMatchObject({ ok: true, changed: true });
    expect((await saveGoogleChatWebhookSettings(deps, actor, '', 'https://chat/x')).ok).toBe(false);
    expect(await getAdminSettings(deps, actor)).toMatchObject({
      gchatReportWebhookUrl: 'https://chat/report',
      gchatReceiptWebhookUrl: 'https://chat/receipt',
    });
    expect(appLog.actions()).toContain('settings.gchat_webhooks.changed');
  });

  it('別テナントの設定は互いに影響しない', async () => {
    await saveGeminiApiKey(deps, actor, 'key-1');
    await saveGeminiApiKey(deps, { ...actor, tenantId: 'tenant-2' }, 'key-2');
    expect((await getAdminSettings(deps, actor)).geminiApiKey).toBe('key-1');
  });

  describe('listGeminiModelsForAdmin', () => {
    it('入力中のキーがあればそれで一覧を取得する', async () => {
      await saveGeminiApiKey(deps, actor, 'stored-key');
      const result = await listGeminiModelsForAdmin(deps, actor, 'typed-key');
      expect(result.ok).toBe(true);
      expect(listedWith).toEqual(['typed-key']);
    });

    it('入力中のキーが空なら保存済みのキーを使う(GAS版と同じ)', async () => {
      await saveGeminiApiKey(deps, actor, 'stored-key');
      await listGeminiModelsForAdmin(deps, actor, '  ');
      expect(listedWith).toEqual(['stored-key']);
    });

    it('どちらも無ければAPIを呼ばずに案内を返す', async () => {
      expect(await listGeminiModelsForAdmin(deps, actor, undefined)).toMatchObject({
        ok: false,
        reason: 'no_api_key',
      });
      expect(listedWith).toEqual([]);
    });

    it('API呼び出しの失敗はERRORログに残す', async () => {
      deps.listGeminiModels = async () => {
        throw new Error('HTTP 403');
      };
      expect(await listGeminiModelsForAdmin(deps, actor, 'k')).toMatchObject({
        ok: false,
        reason: 'api_error',
      });
      expect(appLog.entries.at(-1)).toMatchObject({
        level: 'ERROR',
        action: 'settings.gemini_models.list_failed',
      });
    });
  });
});
