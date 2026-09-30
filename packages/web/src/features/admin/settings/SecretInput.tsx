import { SECRET_MASK_CHAR } from '@katahimo/shared';
import { useVisibilityToggle } from '../../../ui/useVisibilityToggle';
import type { AdminSettingsLoadStatus } from './useAdminSettingsForm';

/** 読み込み状態に応じた入力欄の案内(GAS版: 読み込み中は「読み込み中...」、失敗は「取得に失敗しました」)。 */
export function loadingPlaceholder(status: AdminSettingsLoadStatus): string {
  if (status === 'loading') return '読み込み中...';
  if (status === 'failed') return '取得に失敗しました';
  return '';
}

/**
 * APIキー・Webhook URLの入力欄(ふだんは伏せ字、「表示」で見える。GAS版 toggleGeminiApiKeyVisibility)。
 *
 * GAS版と違い、サーバーは保存済みの値を平文では返さず伏せ字(末尾4文字等だけ残した値)を返すため、
 * 「表示」を押しても見えるのは伏せ字になる(意図した違い)。伏せ字のまま保存すると変更なしとして扱われる。
 * 伏せ字の一部だけを書き換えると保存を拒否されるため、伏せ字の入った欄にフォーカスしたら全体を選択し、
 * 入力で丸ごと置き換わるようにする。
 */
export function SecretInput({
  id,
  value,
  onChange,
  status,
  errorId,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  status: AdminSettingsLoadStatus;
  /** 入力欄のエラーの文言の要素の id(あれば aria-invalid と aria-describedby を付ける)。 */
  errorId?: string;
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
        onFocus={(e) => {
          if (e.currentTarget.value.includes(SECRET_MASK_CHAR)) e.currentTarget.select();
        }}
        placeholder={loadingPlaceholder(status)}
        disabled={status !== 'loaded'}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        className={`flex-1 min-w-0 px-3 py-2 border ${errorId ? 'border-red-500' : 'border-gray-300'} rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100`}
      />
      <button
        type="button"
        onClick={visibility.toggle}
        className="min-h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm font-bold text-gray-800"
      >
        {visibility.visible ? '隠す' : '表示'}
      </button>
    </div>
  );
}
