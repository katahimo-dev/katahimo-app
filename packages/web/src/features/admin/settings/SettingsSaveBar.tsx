import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../components/FormField';
import type { AdminSettingsForm } from './useAdminSettingsForm';

/** APIキー / 通知先の下の「元に戻す」「保存する」。 */
export function SettingsSaveBar({
  form,
  saving,
  onSave,
  savingLabel = '保存中...',
}: {
  form: AdminSettingsForm;
  saving: boolean;
  onSave: () => void;
  /** 保存中のボタンの文言(APIキーはサーバーが Gemini で確かめるので「確認中...」)。 */
  savingLabel?: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      {form.dirty ? (
        <span className="self-center mr-auto text-xs font-bold text-amber-800">
          保存していない変更があります
        </span>
      ) : null}
      <button
        type="button"
        onClick={form.reload}
        disabled={saving || form.status === 'loading'}
        className={SECONDARY_BUTTON}
      >
        {form.dirty ? '元に戻す' : '🔄 読み込み直す'}
      </button>
      <button type="button" onClick={onSave} disabled={saving || !form.dirty} className={PRIMARY_BUTTON}>
        {saving ? savingLabel : '保存する'}
      </button>
    </div>
  );
}
