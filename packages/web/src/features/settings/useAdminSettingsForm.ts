import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsApi } from '../../api/settings';
import { showErrorToast, showToast } from '../../ui/toast';
import { buildModelOptions, type ModelOption } from './modelOptions';
import { type AdminSettingsValues, planSettingsSave } from './saveSettingsPlan';

export type AdminSettingsLoadStatus = 'loading' | 'loaded' | 'failed';

const EMPTY_VALUES: AdminSettingsValues = {
  geminiApiKey: '',
  reportModel: '',
  ocrModel: '',
  reportWebhookUrl: '',
  receiptWebhookUrl: '',
};

/**
 * 設定ダイアログの「詳細設定（管理者のみ）」の読み込み・入力・保存(GAS版 setupAdminSettingsArea /
 * loadGeminiModelSettings / loadGChatWebhookSettings / refreshGeminiModelList / saveSettings)。
 *
 * GAS版と同じく、ダイアログを開くたびにサーバーから読み直し、読み込みが終わるまでは入力欄を
 * 無効にして保存もさせない(現在の値を確認できていない状態で上書きしないため)。
 * GAS版は3つのAPIで別々に読み込んでいたが、新APIは GET /api/settings/admin の1回で全部読む。
 */
export function useAdminSettingsForm(open: boolean, enabled: boolean) {
  const [status, setStatus] = useState<AdminSettingsLoadStatus>('loading');
  const [loaded, setLoaded] = useState<AdminSettingsValues | null>(null);
  const [values, setValues] = useState<AdminSettingsValues>(EMPTY_VALUES);
  const [reportModelOptions, setReportModelOptions] = useState<ModelOption[]>([]);
  const [ocrModelOptions, setOcrModelOptions] = useState<ModelOption[]>([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  // 開き直したあとに古い読み込みの結果が届いても無視するための世代番号
  const loadSeq = useRef(0);

  useEffect(() => {
    if (!open || !enabled) return;
    const seq = ++loadSeq.current;
    setStatus('loading');
    setLoaded(null);
    setValues(EMPTY_VALUES);
    settingsApi
      .get()
      .then(({ settings }) => {
        if (seq !== loadSeq.current) return;
        const next: AdminSettingsValues = {
          geminiApiKey: settings.geminiApiKey,
          reportModel: settings.geminiReportModel,
          ocrModel: settings.geminiOcrModel,
          reportWebhookUrl: settings.gchatReportWebhookUrl,
          receiptWebhookUrl: settings.gchatReceiptWebhookUrl,
        };
        setLoaded(next);
        setValues(next);
        setReportModelOptions(buildModelOptions(next.reportModel, []));
        setOcrModelOptions(buildModelOptions(next.ocrModel, []));
        setStatus('loaded');
      })
      .catch((e: unknown) => {
        if (seq !== loadSeq.current) return;
        setStatus('failed');
        showErrorToast(e);
      });
  }, [open, enabled]);

  const setValue = useCallback(
    <K extends keyof AdminSettingsValues>(key: K, value: AdminSettingsValues[K]) => {
      setValues((v) => ({ ...v, [key]: value }));
    },
    [],
  );

  /** 「🔄 最新モデル一覧を取得」。保存前の入力中のAPIキーで取得する(空ならサーバーが保存済みのキーを使う)。 */
  const refreshModels = useCallback(async () => {
    if (status === 'loading') return;
    // 現在選択中の値は一覧更新後も失われないよう保持しておく
    const currentReport = values.reportModel || loaded?.reportModel || '';
    const currentOcr = values.ocrModel || loaded?.ocrModel || '';
    setRefreshingModels(true);
    try {
      const res = await settingsApi.listAvailableModels(values.geminiApiKey.trim());
      setReportModelOptions(buildModelOptions(currentReport, res.models));
      setOcrModelOptions(buildModelOptions(currentOcr, res.models));
      setValues((v) => ({ ...v, reportModel: currentReport, ocrModel: currentOcr }));
      showToast(`モデル一覧を更新しました(${res.models.length}件)`);
    } catch (e) {
      showErrorToast(e);
    } finally {
      setRefreshingModels(false);
    }
  }, [status, values, loaded]);

  /**
   * 保存する。保存できた(または変更が無かった)ら true。
   * 変更のあった設定だけを、APIキー → モデル → Webhook の順に保存する(GAS版と同じ順)。
   */
  const save = useCallback(async (): Promise<boolean> => {
    const plan = planSettingsSave(status === 'loaded' ? loaded : null, values);
    if (plan.kind === 'error') {
      showToast(plan.message, true);
      return false;
    }
    if (plan.kind === 'nothing') return true;

    const v = plan.values;
    try {
      if (plan.keyChanged) {
        await settingsApi.saveGeminiApiKey(v.geminiApiKey);
        setLoaded((l) => (l ? { ...l, geminiApiKey: v.geminiApiKey } : l));
      }
      if (plan.modelsChanged) {
        await settingsApi.saveGeminiModels(v.reportModel, v.ocrModel);
        setLoaded((l) => (l ? { ...l, reportModel: v.reportModel, ocrModel: v.ocrModel } : l));
      }
      if (plan.webhooksChanged) {
        await settingsApi.saveGchatWebhooks(v.reportWebhookUrl, v.receiptWebhookUrl);
        setLoaded((l) =>
          l ? { ...l, reportWebhookUrl: v.reportWebhookUrl, receiptWebhookUrl: v.receiptWebhookUrl } : l,
        );
      }
      return true;
    } catch (e) {
      showErrorToast(e, '保存に失敗しました');
      return false;
    }
  }, [status, loaded, values]);

  return {
    status,
    values,
    setValue,
    reportModelOptions,
    ocrModelOptions,
    refreshingModels,
    refreshModels,
    save,
  };
}

export type AdminSettingsForm = ReturnType<typeof useAdminSettingsForm>;
