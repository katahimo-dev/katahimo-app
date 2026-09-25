import { useVisibilityToggle } from '../../ui/useVisibilityToggle';
import type { AdminSettingsLoadStatus } from './useAdminSettingsForm';

/** 読み込み状態に応じた入力欄の案内(GAS版: 読み込み中は「読み込み中...」、失敗は「取得に失敗しました」)。 */
export function loadingPlaceholder(status: AdminSettingsLoadStatus): string {
  if (status === 'loading') return '読み込み中...';
  if (status === 'failed') return '取得に失敗しました';
  return '';
}

/** APIキー・Webhook URLの入力欄(ふだんは伏せ字、「表示」で見える。GAS版 toggleGeminiApiKeyVisibility)。 */
export function SecretInput({
  id,
  value,
  onChange,
  status,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  status: AdminSettingsLoadStatus;
}) {
  const visibility = useVisibilityToggle();
  return (
    <div className="flex gap-1">
      <input
        type={visibility.visible ? 'text' : 'password'}
        id={id}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={loadingPlaceholder(status)}
        disabled={status !== 'loaded'}
        className="flex-1 p-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="button"
        onClick={visibility.toggle}
        className="min-h-12 px-3 rounded-xl bg-gray-200 text-sm font-bold text-gray-800"
      >
        {visibility.visible ? '隠す' : '表示'}
      </button>
    </div>
  );
}
