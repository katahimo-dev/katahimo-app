import { PUSH_AVAILABILITY_MESSAGES } from './pushSupport';
import { usePushSettings } from './usePushSettings';

/**
 * 設定ダイアログの「通知」(翌日の予定のお知らせ。GAS版の夜間の LINE WORKS DM の置き換えで、GAS版の画面には無い)。
 * サーバーが通知を使えない(VAPID の設定が無い)ときは出さない。受け取れない端末・拒否されているときは理由を出す。
 */
export function NotificationSettingsSection({ open }: { open: boolean }) {
  const push = usePushSettings(open);
  if (!push.visible) return null;
  const blockedMessage =
    push.availability === 'available' ? null : PUSH_AVAILABILITY_MESSAGES[push.availability];

  return (
    <div className="border-t pt-4">
      <h4 className="font-bold text-gray-800 text-base mb-3">通知</h4>
      <label className="flex items-center justify-between gap-3 min-h-12 p-3 rounded-xl border border-gray-200 cursor-pointer has-[:disabled]:cursor-default">
        <span className="text-base text-gray-800">翌日の予定を通知する</span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={push.enabled}
          checked={push.enabled}
          disabled={blockedMessage !== null || push.busy}
          onChange={(e) => push.setEnabled(e.target.checked)}
          className="w-6 h-6 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
      </label>
      {blockedMessage ? (
        <p className="text-sm text-red-600 mt-2" role="note">
          {blockedMessage}
        </p>
      ) : (
        <p className="text-sm text-gray-600 mt-2">
          毎日夜（19時ごろ）に、明日の予定の時刻とお客様のお名前をこの端末に通知します。通知を押すと明日の予定を開きます。
        </p>
      )}
      <button
        type="button"
        onClick={push.sendTest}
        disabled={!push.enabled || push.testing}
        className="w-full min-h-12 mt-3 py-3 rounded-xl text-sm font-bold bg-gray-200 text-gray-800 disabled:opacity-50"
      >
        {push.testing ? '送信中...' : 'テスト通知を送る'}
      </button>
    </div>
  );
}
