import { CARD_CLASS } from '../components/FormField';
import { useReportUnsavedChanges } from '../unsavedChanges';
import { SecretInput } from './SecretInput';
import { SettingsSaveBar } from './SettingsSaveBar';
import { useAdminSettingsForm } from './useAdminSettingsForm';
import { useSaveSettings } from './useSaveSettings';

/**
 * 管理タブ「通知先」(GAS版は設定ダイアログの「詳細設定」)。Google Chat の Webhook URL(日報・事故報告 / 領収書登録)。
 * スタッフの端末への通知(Web Push)は各自の設定ダイアログの「通知」で入れる。
 */
export function NotificationTargetsPanel() {
  const form = useAdminSettingsForm();
  const { saving, save } = useSaveSettings(form, '通知先を保存しました');
  const { status, values, setValue } = form;
  useReportUnsavedChanges(form.dirty);

  return (
    <section aria-labelledby="notificationTargetsHeading" className={`${CARD_CLASS} space-y-3`}>
      <h2 id="notificationTargetsHeading" className="text-sm font-bold text-gray-800">
        Google Chat の通知先(Webhook URL)
      </h2>
      <div>
        <label htmlFor="settingGChatReportWebhook" className="block text-xs font-bold text-gray-700 mb-1">
          日報・事故報告
        </label>
        <SecretInput
          id="settingGChatReportWebhook"
          value={values.reportWebhookUrl}
          onChange={(v) => setValue('reportWebhookUrl', v)}
          status={status}
        />
        <p className="text-xs text-gray-600 mt-1">
          日報・事故報告・訪問完了・PSI の知らせの送信先。空にはできません。
        </p>
      </div>
      <div>
        <label htmlFor="settingGChatReceiptWebhook" className="block text-xs font-bold text-gray-700 mb-1">
          領収書登録
        </label>
        <SecretInput
          id="settingGChatReceiptWebhook"
          value={values.receiptWebhookUrl}
          onChange={(v) => setValue('receiptWebhookUrl', v)}
          status={status}
        />
        <p className="text-xs text-gray-600 mt-1">領収書の登録・取消の知らせの送信先。空にはできません。</p>
      </div>
      <SettingsSaveBar form={form} saving={saving} onSave={() => void save()} />
    </section>
  );
}
