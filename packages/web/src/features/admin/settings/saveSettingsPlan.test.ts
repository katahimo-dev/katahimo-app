import { describe, expect, it } from 'vitest';
import { buildModelOptions, modelOptionLabel } from './modelOptions';
import { type AdminSettingsValues, planSettingsSave } from './saveSettingsPlan';

const loaded: AdminSettingsValues = {
  geminiApiKey: 'key-1',
  reportModel: 'gemini-2.5-flash',
  ocrModel: 'gemini-2.5-flash-lite',
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

  it('モデルの未選択・Webhook URLの空は保存しない', () => {
    expect(planSettingsSave(loaded, { ...loaded, ocrModel: '' })).toEqual({
      kind: 'error',
      message: 'モデルが未選択です',
    });
    expect(planSettingsSave(loaded, { ...loaded, receiptWebhookUrl: ' ' })).toEqual({
      kind: 'error',
      message: 'Webhook URLが空です',
    });
  });

  it('APIキーの検査がモデル・Webhookより先(GAS版と同じ順)', () => {
    expect(
      planSettingsSave(loaded, { ...loaded, geminiApiKey: '', ocrModel: '', reportWebhookUrl: '' }),
    ).toEqual({
      kind: 'error',
      message: 'Gemini APIキーを空にすることはできません',
    });
  });

  it('変わった設定だけを、空白を除いた値で保存する', () => {
    expect(planSettingsSave(loaded, { ...loaded, reportWebhookUrl: ' https://chat.example/new ' })).toEqual({
      kind: 'save',
      keyChanged: false,
      modelsChanged: false,
      webhooksChanged: true,
      values: { ...loaded, reportWebhookUrl: 'https://chat.example/new' },
    });
  });
});

describe('buildModelOptions(GAS版 setSelectOptions_)', () => {
  it('現在の値を「(現在の設定)」として先頭に残し、重複を除く', () => {
    const options = buildModelOptions('gemini-2.5-flash', [
      { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
      { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { name: 'gemini-2.5-pro', displayName: 'dup' },
    ]);
    expect(options).toEqual([
      { name: 'gemini-2.5-flash', displayName: '(現在の設定)' },
      { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    ]);
    expect(options.map(modelOptionLabel)).toEqual([
      'gemini-2.5-flash - (現在の設定)',
      'gemini-2.5-pro - Gemini 2.5 Pro',
    ]);
  });

  it('現在の値が空なら一覧だけ', () => {
    expect(buildModelOptions('', [{ name: 'm', displayName: '' }]).map(modelOptionLabel)).toEqual(['m']);
  });
});
