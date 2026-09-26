import type { DailyReportAiInfo } from '@katahimo/shared';
import { useRef } from 'react';
import { showToast } from '../../../ui/toast';
import { cx } from './cx';

/**
 * AIが書いた日報(「事務局に送る文」「保護者に送る文」)。GAS版 #resultArea。
 * 保護者に送る文は「📋 コピーしてLINEに貼る」でコピーできる。PSI 1(危険・緊急)は管理者への連絡を促す帯を出し、
 * 日報AIが使った教育キーワードを並べる。
 */
export function DailyResult({
  shown,
  internalText,
  customerText,
  aiInfo,
  onChange,
}: {
  shown: boolean;
  internalText: string;
  customerText: string;
  aiInfo: DailyReportAiInfo | null;
  onChange: (field: 'internalText' | 'customerText', value: string) => void;
}) {
  const customerTextRef = useRef<HTMLTextAreaElement>(null);
  const copyCustomerText = async () => {
    // GAS版と同じく文を選んだ状態にしてからコピーする(どこがコピーされたか見て分かるように)
    customerTextRef.current?.select();
    try {
      await navigator.clipboard.writeText(customerText);
    } catch {
      // 使えないブラウザでは何もしない(GAS版の execCommand と同じく、お知らせは出す)
    }
    showToast('コピーしました。LINEを開いて貼りつけてください');
  };

  return (
    <div id="resultArea" className={cx(!shown && 'hidden', 'space-y-4 pt-4 border-t')}>
      {aiInfo?.escalationRequired ? (
        <div
          role="alert"
          className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-800 text-base font-bold"
        >
          🚨 PSI 1（危険・緊急）: 日報より安全対応を優先し、すぐに管理者へ電話で連絡してください。
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600" />
          事務局に送る文
          <span id="internalCount" className="text-sm text-gray-600 font-normal ml-2">
            {internalText.length}文字
          </span>
        </h3>
        <textarea
          id="internalResult"
          rows={10}
          aria-label="事務局に送る文"
          value={internalText}
          onChange={(e) => onChange('internalText', e.target.value)}
          className="w-full p-3 bg-white rounded-xl text-base leading-relaxed text-gray-900 border border-gray-200 focus:ring-2 focus:ring-blue-300"
        />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between items-center gap-3">
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-600" />
            保護者に送る文
            <span id="customerCount" className="text-sm text-gray-600 font-normal ml-2">
              {customerText.length}文字
            </span>
          </h3>
          <button
            type="button"
            onClick={() => void copyCustomerText()}
            className="min-h-12 text-base bg-green-600 text-white px-4 py-3 rounded-xl font-bold flex items-center gap-1 whitespace-nowrap"
          >
            📋 コピーしてLINEに貼る
          </button>
        </div>
        {aiInfo && aiInfo.usedKeywords.length > 0 ? (
          <div id="usedKeywords" className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-gray-600">使った教育キーワード:</span>
            {aiInfo.usedKeywords.map((k) => (
              <span
                key={k.code}
                className={cx(
                  'px-2 py-0.5 rounded-full font-bold',
                  k.known ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600',
                )}
              >
                {k.keyword ? `${k.code} ${k.keyword}` : k.code}
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          id="customerResult"
          ref={customerTextRef}
          rows={10}
          aria-label="保護者に送る文"
          value={customerText}
          onChange={(e) => onChange('customerText', e.target.value)}
          className="w-full p-3 bg-white rounded-xl text-base leading-relaxed text-gray-900 border border-gray-200 focus:ring-2 focus:ring-green-300"
        />
      </div>
    </div>
  );
}
