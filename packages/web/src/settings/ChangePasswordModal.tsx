import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { changePassword } from '../api';

/** GAS版index.htmlのopenChangePass()モーダルと同じ役割・見た目にしている。 */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (newPassword !== confirmPassword) {
      setValidationError('新しいパスワードが一致しません');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[130] flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white w-full max-w-sm rounded-xl shadow-xl flex flex-col max-h-[90vh]"
      >
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800">パスワード変更</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="currentPassword">
              現在のパスワード
            </label>
            <input
              id="currentPassword"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="newPassword">
              新しいパスワード
            </label>
            <input
              id="newPassword"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="confirmPassword">
              新しいパスワード(確認)
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="text-red-500 text-xs min-h-[1rem]">
            {validationError || (mutation.isError ? mutation.error.message : '')}
          </div>
          {mutation.isSuccess && <p className="text-green-600 text-xs">パスワードを変更しました</p>}
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-300"
          >
            閉じる
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {mutation.isPending ? '変更中…' : '変更する'}
          </button>
        </div>
      </form>
    </div>
  );
}
