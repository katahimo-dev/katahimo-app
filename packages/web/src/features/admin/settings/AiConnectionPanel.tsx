import { CARD_CLASS } from '../components/FormField';
import { useReportUnsavedChanges } from '../unsavedChanges';
import { SecretInput } from './SecretInput';
import { SettingsSaveBar } from './SettingsSaveBar';
import { useAdminSettingsForm } from './useAdminSettingsForm';
import { useSaveSettings } from './useSaveSettings';

/**
 * 管理タブ「AI → APIキー」(GAS版は設定ダイアログの「詳細設定」)。Gemini の APIキー。
 * モデルは自動で選ぶ(日報・事故報告は Flash 系 → Flash-Lite 系、領収書の読み取りは Flash-Lite 系。doc/05 6章)ので、
 * モデルを選ぶ欄は無い。
 */
export function AiConnectionPanel() {
  const form = useAdminSettingsForm();
  const { saving, save } = useSaveSettings(form, 'APIキーを保存しました');
  const { status, values, setValue } = form;
  useReportUnsavedChanges(form.dirty);

  return (
    <section aria-labelledby="aiConnectionHeading" className={`${CARD_CLASS} space-y-3`}>
      <h3 id="aiConnectionHeading" className="text-sm font-bold text-gray-800">
        Gemini の APIキー
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
        <p className="text-xs text-gray-600 mt-1">
          モデルは自動で選びます(日報・事故報告は Gemini Flash → Flash-Lite、領収書OCRは Flash-Lite
          の新しいものから。使えないときは次のモデルに切り替えます)。
        </p>
      </div>
      <SettingsSaveBar form={form} saving={saving} onSave={() => void save()} />
    </section>
  );
}
