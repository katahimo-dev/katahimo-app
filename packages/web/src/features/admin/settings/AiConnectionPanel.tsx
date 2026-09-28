import { CARD_CLASS, SECONDARY_BUTTON } from '../components/FormField';
import { useReportUnsavedChanges } from '../unsavedChanges';
import { ModelSelect } from './ModelSelect';
import { SecretInput } from './SecretInput';
import { SettingsSaveBar } from './SettingsSaveBar';
import { useAdminSettingsForm } from './useAdminSettingsForm';
import { useSaveSettings } from './useSaveSettings';

const SELECT_CLASS =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100';

/**
 * 管理タブ「AI → APIキー・モデル」(GAS版は設定ダイアログの「詳細設定」)。Gemini の APIキーと、日報・事故報告 / 領収書OCR で使うモデル。
 */
export function AiConnectionPanel() {
  const form = useAdminSettingsForm();
  const { saving, save } = useSaveSettings(form, 'APIキー・モデルを保存しました');
  const { status, values, setValue } = form;
  useReportUnsavedChanges(form.dirty);

  return (
    <section aria-labelledby="aiConnectionHeading" className={`${CARD_CLASS} space-y-3`}>
      <h3 id="aiConnectionHeading" className="text-sm font-bold text-gray-800">
        Gemini の APIキー・モデル
      </h3>
      <div>
        <label htmlFor="settingGeminiApiKey" className="block text-xs font-bold text-gray-700 mb-1">
          Gemini APIキー
        </label>
        <SecretInput
          id="settingGeminiApiKey"
          value={values.geminiApiKey}
          onChange={(v) => setValue('geminiApiKey', v)}
          status={status}
        />
        <p className="text-xs text-gray-600 mt-1">
          日報・事故報告のAI生成、領収書OCRに使います。空にはできません。
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="settingGeminiReportModel" className="block text-xs font-bold text-gray-700 mb-1">
            日報・事故報告のモデル
          </label>
          <ModelSelect
            id="settingGeminiReportModel"
            value={values.reportModel}
            options={form.reportModelOptions}
            onChange={(v) => setValue('reportModel', v)}
            status={status}
            className={SELECT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="settingGeminiOcrModel" className="block text-xs font-bold text-gray-700 mb-1">
            領収書OCRのモデル
          </label>
          <ModelSelect
            id="settingGeminiOcrModel"
            value={values.ocrModel}
            options={form.ocrModelOptions}
            onChange={(v) => setValue('ocrModel', v)}
            status={status}
            className={SELECT_CLASS}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={form.refreshModels}
          disabled={form.refreshingModels || status !== 'loaded'}
          className={SECONDARY_BUTTON}
        >
          {form.refreshingModels ? '取得中...' : '🔄 最新モデル一覧を取得'}
        </button>
        <span className="text-xs text-gray-600">
          入力中のAPIキーで取得します(保存前でも確かめられます)。モデルが使えなくなったらここで切り替えます。
        </span>
      </div>
      <SettingsSaveBar form={form} saving={saving} onSave={() => void save()} />
    </section>
  );
}
