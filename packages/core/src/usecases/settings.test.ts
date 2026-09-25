import { beforeEach, describe, expect, it } from 'vitest';
import type { SettingsDeps } from './settings';
import {
  getAdminSettings,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
} from './settings';
import { FakeAppSettingsRepository, FakeCryptoPort } from './testDoubles';

describe('管理者設定(app_settings)', () => {
  let deps: SettingsDeps;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    deps = { appSettings: new FakeAppSettingsRepository(), crypto: new FakeCryptoPort() };
  });

  it('未設定時はGemini APIキー/Webhook URLが空文字、モデルはデフォルト値を返す', async () => {
    const settings = await getAdminSettings(deps, tenantId);
    expect(settings).toEqual({
      geminiApiKey: '',
      geminiReportModel: 'gemini-2.5-flash',
      geminiOcrModel: 'gemini-2.5-flash-lite',
      gchatReportWebhookUrl: '',
      gchatReceiptWebhookUrl: '',
    });
  });

  it('Gemini APIキーを保存すると復号して取得できる', async () => {
    const result = await saveGeminiApiKey(deps, tenantId, 'sk-test-key');
    expect(result.ok).toBe(true);
    const settings = await getAdminSettings(deps, tenantId);
    expect(settings.geminiApiKey).toBe('sk-test-key');
  });

  it('空文字でのGemini APIキー保存は拒否され、既存の値が保持される', async () => {
    await saveGeminiApiKey(deps, tenantId, 'sk-existing');
    const result = await saveGeminiApiKey(deps, tenantId, '   ');
    expect(result.ok).toBe(false);
    const settings = await getAdminSettings(deps, tenantId);
    expect(settings.geminiApiKey).toBe('sk-existing');
  });

  it('モデル設定を保存できる。どちらか一方でも空なら拒否される', async () => {
    const result = await saveGeminiModelSettings(deps, tenantId, 'gemini-3.0-pro', 'gemini-3.0-flash');
    expect(result.ok).toBe(true);
    expect(await getAdminSettings(deps, tenantId)).toMatchObject({
      geminiReportModel: 'gemini-3.0-pro',
      geminiOcrModel: 'gemini-3.0-flash',
    });

    const rejected = await saveGeminiModelSettings(deps, tenantId, '', 'gemini-3.0-flash');
    expect(rejected.ok).toBe(false);
    expect(await getAdminSettings(deps, tenantId)).toMatchObject({
      geminiReportModel: 'gemini-3.0-pro',
      geminiOcrModel: 'gemini-3.0-flash',
    });
  });

  it('Webhook URLを保存できる。どちらか一方でも空なら拒否される', async () => {
    const result = await saveGoogleChatWebhookSettings(
      deps,
      tenantId,
      'https://chat.googleapis.com/report',
      'https://chat.googleapis.com/receipt',
    );
    expect(result.ok).toBe(true);
    expect(await getAdminSettings(deps, tenantId)).toMatchObject({
      gchatReportWebhookUrl: 'https://chat.googleapis.com/report',
      gchatReceiptWebhookUrl: 'https://chat.googleapis.com/receipt',
    });

    const rejected = await saveGoogleChatWebhookSettings(deps, tenantId, '', 'https://chat.googleapis.com/x');
    expect(rejected.ok).toBe(false);
  });

  it('別テナントの設定は互いに影響しない', async () => {
    await saveGeminiApiKey(deps, 'tenant-1', 'key-1');
    await saveGeminiApiKey(deps, 'tenant-2', 'key-2');
    expect((await getAdminSettings(deps, 'tenant-1')).geminiApiKey).toBe('key-1');
    expect((await getAdminSettings(deps, 'tenant-2')).geminiApiKey).toBe('key-2');
  });
});
