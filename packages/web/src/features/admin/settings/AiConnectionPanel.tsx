import { CARD_CLASS } from '../components/FormField';
import { useReportUnsavedChanges } from '../unsavedChanges';
import { SecretInput } from './SecretInput';
import { SettingsSaveBar } from './SettingsSaveBar';
import { useAdminSettingsForm } from './useAdminSettingsForm';
import { useSaveSettings } from './useSaveSettings';

/**
 * 管理タブ「AI → APIキー」(GAS版は設定ダイアログの「詳細設定」)。Gemini の APIキー。
 * モデルは自動で選ぶ(日報・事故報告は Flash 系 → Flash-Lite 系、領収書の読み取りは Flash-Lite 系。doc/05 6章)ので、
 * モデルを選ぶ欄は無い。新しいキーはサーバーが保存の前に Gemini で確かめ、使えない・確かめられないときは保存せず、
 * 文言を入力欄の下に出して入力を残す(保存中のボタンは「確認中...」)。
 */
export function AiConnectionPanel() {
  const form = useAdminSettingsForm();
  const { saving, save } = useSaveSettings(form, 'APIキーを保存しました');
  const { status, values, fieldErrors, setValue } = form;
  const keyError = fieldErrors.geminiApiKey;
  useReportUnsavedChanges(form.dirty);

  return (
    <section aria-labelledby="aiConnectionHeading" className={`${CARD_CLASS} space-y-3 lg:max-w-3xl`}>
      <h3 id="aiConnectionHeading" className="text-sm font-bold text-gray-800">
        Gemini の APIキー
      </h3>
      <div>
        {/* 見出しと同じ文言を2度出さないよう、入力欄の名前は読み上げだけにする */}
        <label htmlFor="settingGeminiApiKey" className="sr-only">
          Gemini APIキー
        </label>
        <SecretInput
          id="settingGeminiApiKey"
          value={values.geminiApiKey}
          onChange={(v) => setValue('geminiApiKey', v)}
          status={status}
          {...(keyError ? { errorId: 'settingGeminiApiKeyError' } : {})}
        />
        {keyError ? (
          <p id="settingGeminiApiKeyError" role="alert" className="text-xs font-bold text-red-700 mt-1">
            {keyError}
          </p>
        ) : null}
        <p className="text-xs text-gray-600 mt-1">
          日報・事故報告のAI生成、領収書OCRに使います。空にはできません。新しいキーは保存の前に Gemini
          で使えるか確かめ、使えないキーは保存しません。
        </p>
        <p className="text-xs text-gray-600 mt-1">
          モデルは自動で選びます(日報・事故報告は Gemini Flash → Flash-Lite、領収書OCRは Flash-Lite
          の新しいものから。使えないときは次のモデルに切り替えます)。
        </p>
      </div>
      <SettingsSaveBar form={form} saving={saving} savingLabel="確認中..." onSave={() => void save()} />
    </section>
  );
}
