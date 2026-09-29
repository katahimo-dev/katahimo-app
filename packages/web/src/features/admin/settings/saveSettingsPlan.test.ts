import { describe, expect, it } from 'vitest';
import { type AdminSettingsValues, planSettingsSave } from './saveSettingsPlan';

const loaded: AdminSettingsValues = {
  geminiApiKey: 'key-1',
  reportWebhookUrl: 'https://chat.example/report',
  receiptWebhookUrl: 'https://chat.example/receipt',
};

describe('planSettingsSave(GAS版 saveSettings の判定)', () => {
  it('読み込みが終わっていなければ保存しない', () => {
    expect(planSettingsSave(null, loaded)).toEqual({
      kind: 'error',
      message: 'Gemini APIキーの読み込みが完了してから保存してください',
    });
  });

  it('変更が無ければ何も保存しない(前後の空白だけの違いは変更とみなさない)', () => {
    expect(planSettingsSave(loaded, { ...loaded, geminiApiKey: ' key-1 ' })).toEqual({ kind: 'nothing' });
  });

  it('APIキーを空にはできない', () => {
    expect(planSettingsSave(loaded, { ...loaded, geminiApiKey: '  ' })).toEqual({
      kind: 'error',
      message: 'Gemini APIキーを空にすることはできません',
    });
  });

  it('Webhook URLの空は保存しない', () => {
    expect(planSettingsSave(loaded, { ...loaded, receiptWebhookUrl: ' ' })).toEqual({
      kind: 'error',
      message: 'Webhook URLが空です',
    });
  });

  it('APIキーの検査がWebhookより先(GAS版と同じ順)', () => {
    expect(planSettingsSave(loaded, { ...loaded, geminiApiKey: '', reportWebhookUrl: '' })).toEqual({
      kind: 'error',
      message: 'Gemini APIキーを空にすることはできません',
    });
  });

  it('変わった設定だけを、空白を除いた値で保存する', () => {
    expect(planSettingsSave(loaded, { ...loaded, reportWebhookUrl: ' https://chat.example/new ' })).toEqual({
      kind: 'save',
      keyChanged: false,
      webhooksChanged: true,
      values: { ...loaded, reportWebhookUrl: 'https://chat.example/new' },
    });
  });
});
