import { isAdminRole } from '@katahimo/shared';
import { isDemoMode } from '../../lib/demo';
import { confirmNative } from '../../ui/confirm';
import { FadeModal, ModalHeader } from '../../ui/modal';
import { showToast } from '../../ui/toast';
import { useSession } from '../auth';
import { NotificationSettingsSection } from '../notifications';
import { TextSizeOptions } from './TextSizeOptions';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onOpenChangePassword: () => void;
}

/**
 * GAS版 #settingsModal。文字の大きさ・通知・パスワード変更・ログアウト・版数。GAS版の「詳細設定(管理者のみ)」
 * (Gemini の APIキー・モデル、Google Chat の通知先)は「🛠 管理」タブに移した(設定が2か所に分かれないように)。
 * 閉じても中身を残す(GAS版と同じく<details>の開き具合などが次に開いたときも残る)。
 */
export function SettingsModal({ open, onClose, onOpenChangePassword }: SettingsModalProps) {
  const { user, logout } = useSession();
  // 文字の大きさ・通知は選んだときに反映済み(GAS版と同じく「保存して閉じる」はお知らせを出して閉じるだけ)
  const saveSettings = () => {
    showToast('設定を保存しました');
    onClose();
  };

  // 押し間違い防止のため一度確認する(GAS版 confirmLogout は標準の confirm を使う)
  const confirmLogout = () => {
    if (!confirmNative('ログアウトしますか？')) return;
    void logout();
  };

  return (
    <FadeModal
      open={open}
      keepMounted
      labelledBy="settingsModalTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center transition-opacity"
    >
      <div className="bg-white w-full max-w-sm mx-4 rounded-2xl border border-gray-200 flex flex-col max-h-[85vh] transform transition-transform scale-95">
        <ModalHeader title="設定" titleId="settingsModalTitle" onClose={onClose} />
        <div className="p-6 space-y-6 overflow-y-auto">
          <TextSizeOptions />

          <NotificationSettingsSection open={open} />

          {/* 公開デモではパスワードを変えられない(API が断る。共有のアカウントのため) */}
          {isDemoMode() ? null : (
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={onOpenChangePassword}
                className="w-full min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl flex items-center justify-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                パスワード変更
              </button>
            </div>
          )}

          {isAdminRole(user.role) ? (
            <p className="border-t pt-4 text-sm text-gray-600">
              Gemini の APIキー・モデルは「🛠 管理」タブの「🤖 AI」、Google Chat の通知先は「🔔
              通知先」で設定します。
            </p>
          ) : null}

          <div className="border-t pt-4">
            <button
              type="button"
              onClick={confirmLogout}
              className="w-full min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
            >
              ログアウト
            </button>
          </div>

          <div className="text-sm text-gray-600 text-center">Ver. {__APP_VERSION__}</div>
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-2xl flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={saveSettings}
            className="min-h-12 px-4 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
          >
            保存して閉じる
          </button>
        </div>
      </div>
    </FadeModal>
  );
}
