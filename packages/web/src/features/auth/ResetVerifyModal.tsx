import { PASSWORD_RESET_CODE_LENGTH } from '@katahimo/shared';
import { normalizeResetCodeInput } from './resetCode';

/** 番号の欄の名前(読み上げ・見出し・テストで共通)。 */
export const RESET_CODE_LABEL = `メールに届いた${PASSWORD_RESET_CODE_LENGTH}けたの番号`;

interface ResetVerifyModalProps {
  code: string;
  onCodeChange: (code: string) => void;
  newPassword: string;
  onNewPasswordChange: (password: string) => void;
  error: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

/** GAS版 #resetVerifyModal と同じ見た目(中身は <form>。Enter でも送れる)。 */
export function ResetVerifyModal({
  code,
  onCodeChange,
  newPassword,
  onNewPasswordChange,
  error,
  submitting,
  onCancel,
  onSubmit,
}: ResetVerifyModalProps) {
  return (
    <div className="fixed inset-0 bg-gray-900 z-[60] flex items-center justify-center p-4">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4"
      >
        <h3 className="text-xl font-bold text-gray-800">メールに届いた番号を入力</h3>
        <p className="text-base text-gray-600">{RESET_CODE_LABEL}と、新しいパスワードを入力してください。</p>

        <input
          type="text"
          id="resetCode"
          aria-label={RESET_CODE_LABEL}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => {
            // 日本語入力の変換中はそろえない(変換中の文字を消すと入力が崩れる)。変換の確定と送信のときにそろえる
            const composing = (e.nativeEvent as Partial<InputEvent>).isComposing === true;
            onCodeChange(composing ? e.target.value : normalizeResetCodeInput(e.target.value));
          }}
          onCompositionEnd={(e) => onCodeChange(normalizeResetCodeInput(e.currentTarget.value))}
          className="w-full p-3 text-base rounded-xl border border-gray-300"
          placeholder={RESET_CODE_LABEL}
        />

        <input
          type="password"
          id="resetNewPass"
          aria-label="新しいパスワード"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => onNewPasswordChange(e.target.value)}
          className="w-full p-3 text-base rounded-xl border border-gray-300"
          placeholder="新しいパスワード"
        />

        <div className="text-red-600 text-base text-center" role="alert">
          {error}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 min-h-12 py-3 bg-green-600 text-white text-base font-bold rounded-xl"
          >
            {submitting ? '設定中...' : 'このパスワードにする'}
          </button>
        </div>
      </form>
    </div>
  );
}
