import { useState } from 'react';
import { authApi } from '../../api/auth';
import { userMessageOf } from '../../api/client';
import { alertNative } from '../../ui/confirm';
import { Modal } from '../../ui/modal';

/**
 * GAS版 #changePassModal(設定の「パスワード変更」から開く。設定より手前の z-[110])。
 * 検証・文言は GAS版 doChangePass と同じ。入力した値はGAS版と同じく閉じても残す
 * (ただし変更できたときは消す。GAS版は残していたが、パスワードを画面に残さないため)。
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const doChangePass = async () => {
    if (!current || !next || !confirmation) {
      setError('入力してください');
      return;
    }
    if (next !== confirmation) {
      setError('新しいパスワードが一致しません');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await authApi.changePassword({ currentPassword: current, newPassword: next });
      alertNative('パスワードを変更しました');
      setCurrent('');
      setNext('');
      setConfirmation('');
      onClose();
    } catch (e) {
      setError(userMessageOf(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      keepMounted
      labelledBy="changePassTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center transition-opacity"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void doChangePass();
        }}
        className="bg-white w-full max-w-sm mx-4 rounded-xl shadow-xl flex flex-col transform transition-transform scale-95 p-6 space-y-4"
      >
        <h3 id="changePassTitle" className="font-bold text-gray-800 text-lg">
          パスワード変更
        </h3>

        <div>
          <label htmlFor="chgCurrentPass" className="block text-base font-bold text-gray-700 mb-1">
            いまのパスワード
          </label>
          <input
            type="password"
            id="chgCurrentPass"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full p-3 text-base border border-gray-300 rounded-xl"
          />
        </div>
        <div>
          <label htmlFor="chgNewPass" className="block text-base font-bold text-gray-700 mb-1">
            新しいパスワード
          </label>
          <input
            type="password"
            id="chgNewPass"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full p-3 text-base border border-gray-300 rounded-xl"
          />
        </div>
        <div>
          <label htmlFor="chgConfirmPass" className="block text-base font-bold text-gray-700 mb-1">
            新しいパスワード（もう一度）
          </label>
          <input
            type="password"
            id="chgConfirmPass"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="w-full p-3 text-base border border-gray-300 rounded-xl"
          />
        </div>

        <div className="text-red-600 text-base text-center min-h-[1rem]" role="alert">
          {error}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
          >
            {submitting ? '処理中...' : '変更する'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
