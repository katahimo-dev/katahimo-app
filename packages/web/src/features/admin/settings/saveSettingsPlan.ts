/**
 * 管理タブの API キー・モデル・通知先の「保存する」で何を保存するか・保存してよいかを決める(GAS版 saveSettings の判定部分)。
 * 画面から切り離して、判定の順番と文言をテストできるようにしている。
 */
export interface AdminSettingsValues {
  geminiApiKey: string;
  reportModel: string;
  ocrModel: string;
  reportWebhookUrl: string;
  receiptWebhookUrl: string;
}

export type SaveSettingsPlan =
  | { kind: 'error'; message: string }
  | { kind: 'nothing' }
  | {
      kind: 'save';
      keyChanged: boolean;
      modelsChanged: boolean;
      webhooksChanged: boolean;
      values: AdminSettingsValues;
    };

/**
 * @param loaded サーバーから読み込んだ値(読み込み途中・失敗なら null。この間は保存させない)
 * @param input 画面の入力値(APIキーとWebhook URLは前後の空白を除いて比べる。GAS版と同じ)
 */
export function planSettingsSave(
  loaded: AdminSettingsValues | null,
  input: AdminSettingsValues,
): SaveSettingsPlan {
  // 読み込みが完了していない(=現在の値を確認できていない)状態での保存は禁止する。
  // GAS版は3つの設定を別々に読み込んでいたため文言も3種類あったが、新APIは1回で読み込むので
  // 先頭(APIキー)の文言を使う。
  if (!loaded) return { kind: 'error', message: 'Gemini APIキーの読み込みが完了してから保存してください' };

  const values: AdminSettingsValues = {
    geminiApiKey: input.geminiApiKey.trim(),
    reportModel: input.reportModel,
    ocrModel: input.ocrModel,
    reportWebhookUrl: input.reportWebhookUrl.trim(),
    receiptWebhookUrl: input.receiptWebhookUrl.trim(),
  };

  const keyChanged = values.geminiApiKey !== loaded.geminiApiKey;
  const modelsChanged = values.reportModel !== loaded.reportModel || values.ocrModel !== loaded.ocrModel;
  const webhooksChanged =
    values.reportWebhookUrl !== loaded.reportWebhookUrl ||
    values.receiptWebhookUrl !== loaded.receiptWebhookUrl;

  if (!keyChanged && !modelsChanged && !webhooksChanged) return { kind: 'nothing' };
  if (keyChanged && !values.geminiApiKey)
    return { kind: 'error', message: 'Gemini APIキーを空にすることはできません' };
  if (modelsChanged && (!values.reportModel || !values.ocrModel))
    return { kind: 'error', message: 'モデルが未選択です' };
  if (webhooksChanged && (!values.reportWebhookUrl || !values.receiptWebhookUrl)) {
    return { kind: 'error', message: 'Webhook URLが空です' };
  }
  return { kind: 'save', keyChanged, modelsChanged, webhooksChanged, values };
}
