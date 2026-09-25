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

/** GAS版 #resetVerifyModal と同じ見た目。 */
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
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
        <h3 className="text-xl font-bold text-gray-800">メールに届いた番号を入力</h3>
        <p className="text-base text-gray-600">
          メールに届いた6けたの番号と、新しいパスワードを入力してください。
        </p>

        <input
          type="text"
          id="resetCode"
          aria-label="メールに届いた6けたの番号"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          className="w-full p-3 text-base rounded-xl border border-gray-300"
          placeholder="メールに届いた6けたの番号"
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
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 min-h-12 py-3 bg-green-600 text-white text-base font-bold rounded-xl"
          >
            {submitting ? '設定中...' : 'このパスワードにする'}
          </button>
        </div>
      </div>
    </div>
  );
}
