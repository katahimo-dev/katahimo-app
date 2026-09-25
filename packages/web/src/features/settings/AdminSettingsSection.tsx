import { ModelSelect } from './ModelSelect';
import { SecretInput } from './SecretInput';
import type { AdminSettingsForm } from './useAdminSettingsForm';

/** 設定ダイアログの「詳細設定（管理者のみ）」(GAS版 #adminSettingsArea)。ふだん使わないので折りたたんでおく。 */
export function AdminSettingsSection({ form }: { form: AdminSettingsForm }) {
  const { status, values, setValue } = form;
  return (
    <details className="border-t pt-4">
      <summary className="text-base font-bold text-gray-800 mb-3 cursor-pointer min-h-11 py-2">
        詳細設定（管理者のみ）
      </summary>
      <label htmlFor="settingGeminiApiKey" className="block text-sm font-bold text-gray-700 mb-1">
        Gemini APIキー
      </label>
      <SecretInput
        id="settingGeminiApiKey"
        value={values.geminiApiKey}
        onChange={(v) => setValue('geminiApiKey', v)}
        status={status}
      />
      <p className="text-sm text-gray-600 mt-1">
        ※ 日報・事故報告のAI生成、領収書OCRに使用します。空のまま保存はできません。
      </p>

      <div className="mt-4 pt-4 border-t border-gray-100">
        <label htmlFor="settingGeminiReportModel" className="block text-sm font-bold text-gray-600 mb-1">
          日報・事故報告で使うモデル
        </label>
        <ModelSelect
          id="settingGeminiReportModel"
          value={values.reportModel}
          options={form.reportModelOptions}
          onChange={(v) => setValue('reportModel', v)}
          status={status}
          className="w-full p-3 border border-gray-300 rounded-xl text-base mb-3 focus:ring-2 focus:ring-blue-500"
        />

        <label htmlFor="settingGeminiOcrModel" className="block text-sm font-bold text-gray-600 mb-1">
          領収書OCRで使うモデル
        </label>
        <ModelSelect
          id="settingGeminiOcrModel"
          value={values.ocrModel}
          options={form.ocrModelOptions}
          onChange={(v) => setValue('ocrModel', v)}
          status={status}
          className="w-full p-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500"
        />

        <button
          type="button"
          onClick={form.refreshModels}
          disabled={form.refreshingModels}
          className="w-full min-h-12 mt-3 py-3 rounded-xl text-sm font-bold bg-gray-200 text-gray-800"
        >
          {form.refreshingModels ? '取得中...' : '🔄 最新モデル一覧を取得'}
        </button>
        <p className="text-sm text-gray-600 mt-1">
          ※
          上のAPIキー入力欄の値で一覧を取得します(保存前でも確認できます)。モデルが使えなくなった場合はここで切り替えてください。
        </p>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100">
        <label htmlFor="settingGChatReportWebhook" className="block text-sm font-bold text-gray-600 mb-1">
          日報・事故報告 通知用 Webhook URL
        </label>
        <SecretInput
          id="settingGChatReportWebhook"
          value={values.reportWebhookUrl}
          onChange={(v) => setValue('reportWebhookUrl', v)}
          status={status}
        />
        <p className="text-sm text-gray-600 mt-1">
          ※ 日報・事故報告・訪問完了通知の送信先です。空のまま保存はできません。
        </p>

        <label
          htmlFor="settingGChatReceiptWebhook"
          className="block text-sm font-bold text-gray-600 mt-3 mb-1"
        >
          領収書登録 通知用 Webhook URL
        </label>
        <SecretInput
          id="settingGChatReceiptWebhook"
          value={values.receiptWebhookUrl}
          onChange={(v) => setValue('receiptWebhookUrl', v)}
          status={status}
        />
        <p className="text-sm text-gray-600 mt-1">※ 領収書登録通知の送信先です。空のまま保存はできません。</p>
      </div>
    </details>
  );
}
