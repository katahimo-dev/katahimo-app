import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AdminSettingsView, GeminiModelInfo, StaffView } from '../api';
import {
  fetchAdminSettings,
  listAvailableGeminiModels,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
} from '../api';
import { ChangePasswordModal } from './ChangePasswordModal';
import { applyTextSize, getStoredTextSize, type TextSize } from './textSize';

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: 'small', label: '小 (標準)' },
  { value: 'medium', label: '中 (少し大きく)' },
  { value: 'large', label: '大 (大きく)' },
];

/** 現在の値が一覧に無くても必ず選べるようにする(値が消えないようにするため)。GAS版setSelectOptions_と同じ。 */
function ModelOptions({ current, fetched }: { current: string; fetched: GeminiModelInfo[] }) {
  const options: GeminiModelInfo[] = [];
  const seen = new Set<string>();
  if (current && !seen.has(current)) {
    options.push({ name: current, displayName: '(現在の設定)' });
    seen.add(current);
  }
  for (const m of fetched) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    options.push(m);
  }
  return (
    <>
      {options.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name}
          {m.displayName ? ` - ${m.displayName}` : ''}
        </option>
      ))}
    </>
  );
}

/**
 * 「設定」モーダル。GAS版index.htmlのsettingsModalと同じ役割にしている
 * (文字サイズ・パスワード変更・管理者設定)。管理者設定(Gemini APIキー・モデル・
 * Google Chat Webhook URL)はapp_settingsテーブルにテナント単位で保存され、
 * 日報AI生成/OCR/通知の実処理(reportAi.ts usecases・container.tsのnotifier)が
 * この値を優先して使う(未設定なら.envのデフォルトにフォールバックする)。
 */
export function SettingsModal({ staff, onClose }: { staff: StaffView; onClose: () => void }) {
  const [textSize, setTextSize] = useState<TextSize>(() => getStoredTextSize());
  const [showChangePassword, setShowChangePassword] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: fetchAdminSettings,
    enabled: staff.isAdmin,
  });

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [reportModel, setReportModel] = useState('');
  const [ocrModel, setOcrModel] = useState('');
  const [modelOptions, setModelOptions] = useState<GeminiModelInfo[]>([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [reportWebhook, setReportWebhook] = useState('');
  const [receiptWebhook, setReceiptWebhook] = useState('');
  const [showReportWebhook, setShowReportWebhook] = useState(false);
  const [showReceiptWebhook, setShowReceiptWebhook] = useState(false);

  // 読み込みが完了してから初めてフォームへ反映する(未読み込みのまま保存されて空値等で
  // 上書きされる事故を防ぐため。GAS版のgeminiKeyLoadState等と同じ考え方)。
  useEffect(() => {
    const data: AdminSettingsView | undefined = settingsQuery.data;
    if (!data) return;
    setApiKeyInput(data.geminiApiKey);
    setReportModel(data.geminiReportModel);
    setOcrModel(data.geminiOcrModel);
    setReportWebhook(data.gchatReportWebhookUrl);
    setReceiptWebhook(data.gchatReceiptWebhookUrl);
  }, [settingsQuery.data]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleTextSizeChange = (size: TextSize) => {
    setTextSize(size);
    applyTextSize(size);
  };

  const handleRefreshModels = async () => {
    if (!apiKeyInput.trim()) {
      setSaveError('Gemini APIキーを入力してから取得してください');
      return;
    }
    setRefreshingModels(true);
    setSaveError(null);
    try {
      const models = await listAvailableGeminiModels(apiKeyInput.trim());
      setModelOptions(models);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingModels(false);
    }
  };

  const handleSave = async () => {
    if (!staff.isAdmin || !settingsQuery.data) {
      onClose();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (apiKeyInput !== settingsQuery.data.geminiApiKey) {
        const result = await saveGeminiApiKey(apiKeyInput);
        if (!result.ok) throw new Error(result.message);
      }
      if (
        reportModel !== settingsQuery.data.geminiReportModel ||
        ocrModel !== settingsQuery.data.geminiOcrModel
      ) {
        const result = await saveGeminiModelSettings(reportModel, ocrModel);
        if (!result.ok) throw new Error(result.message);
      }
      if (
        reportWebhook !== settingsQuery.data.gchatReportWebhookUrl ||
        receiptWebhook !== settingsQuery.data.gchatReceiptWebhookUrl
      ) {
        const result = await saveGoogleChatWebhookSettings(reportWebhook, receiptWebhook);
        if (!result.ok) throw new Error(result.message);
      }
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800">設定</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          <div>
            <h4 className="font-bold text-gray-700 mb-3">文字サイズ設定</h4>
            <div className="space-y-3">
              {TEXT_SIZE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50 ${
                    textSize === opt.value ? 'bg-blue-50 border-blue-200' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="textSize"
                    value={opt.value}
                    checked={textSize === opt.value}
                    onChange={() => handleTextSizeChange(opt.value)}
                    className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowChangePassword(true)}
              className="w-full py-2 bg-gray-100 text-gray-700 font-bold rounded-lg hover:bg-gray-200"
            >
              パスワード変更
            </button>
          </div>

          {staff.isAdmin && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-red-600 mb-3">管理者設定</h4>

              {settingsQuery.isPending && (
                <div className="flex justify-center py-4">
                  <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
                </div>
              )}

              {settingsQuery.data && (
                <>
                  <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="geminiApiKey">
                    Gemini APIキー
                  </label>
                  <div className="flex gap-1">
                    <input
                      id="geminiApiKey"
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="flex-1 p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="px-3 rounded border border-gray-300 text-xs text-gray-500 hover:bg-gray-50"
                    >
                      {showApiKey ? '隠す' : '表示'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    ※ 日報・事故報告のAI生成、領収書OCRに使用します。空のまま保存はできません。
                  </p>

                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="geminiReportModel">
                      日報・事故報告で使うモデル
                    </label>
                    <select
                      id="geminiReportModel"
                      value={reportModel}
                      onChange={(e) => setReportModel(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded text-sm mb-3 focus:ring-2 focus:ring-blue-500"
                    >
                      <ModelOptions current={reportModel} fetched={modelOptions} />
                    </select>

                    <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="geminiOcrModel">
                      領収書OCRで使うモデル
                    </label>
                    <select
                      id="geminiOcrModel"
                      value={ocrModel}
                      onChange={(e) => setOcrModel(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <ModelOptions current={ocrModel} fetched={modelOptions} />
                    </select>

                    <button
                      type="button"
                      onClick={handleRefreshModels}
                      disabled={refreshingModels}
                      className="w-full mt-3 py-2 rounded-lg text-xs font-bold border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {refreshingModels ? '取得中…' : '🔄 最新モデル一覧を取得'}
                    </button>
                    <p className="text-[10px] text-gray-400 mt-1">
                      ※
                      上のAPIキー入力欄の値で一覧を取得します(保存前でも確認できます)。モデルが使えなくなった場合はここで切り替えてください。
                    </p>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <label
                      className="block text-xs font-bold text-gray-600 mb-1"
                      htmlFor="gchatReportWebhook"
                    >
                      日報・事故報告 通知用 Webhook URL
                    </label>
                    <div className="flex gap-1">
                      <input
                        id="gchatReportWebhook"
                        type={showReportWebhook ? 'text' : 'password'}
                        value={reportWebhook}
                        onChange={(e) => setReportWebhook(e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowReportWebhook((v) => !v)}
                        className="px-3 rounded border border-gray-300 text-xs text-gray-500 hover:bg-gray-50"
                      >
                        {showReportWebhook ? '隠す' : '表示'}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      ※ 日報・事故報告・訪問完了通知の送信先です。空のまま保存はできません。
                    </p>

                    <label
                      className="block text-xs font-bold text-gray-600 mt-3 mb-1"
                      htmlFor="gchatReceiptWebhook"
                    >
                      領収書登録 通知用 Webhook URL
                    </label>
                    <div className="flex gap-1">
                      <input
                        id="gchatReceiptWebhook"
                        type={showReceiptWebhook ? 'text' : 'password'}
                        value={receiptWebhook}
                        onChange={(e) => setReceiptWebhook(e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowReceiptWebhook((v) => !v)}
                        className="px-3 rounded border border-gray-300 text-xs text-gray-500 hover:bg-gray-50"
                      >
                        {showReceiptWebhook ? '隠す' : '表示'}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      ※ 領収書登録通知の送信先です。空のまま保存はできません。
                    </p>
                  </div>
                </>
              )}

              {settingsQuery.isError && <p className="text-red-500 text-sm">{settingsQuery.error.message}</p>}
            </div>
          )}

          {saveError && <p className="text-red-500 text-sm">{saveError}</p>}
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-300"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (staff.isAdmin && settingsQuery.isPending)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存して閉じる'}
          </button>
        </div>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}
