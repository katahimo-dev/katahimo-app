import { useRef } from 'react';
import { showToast } from '../../../ui/toast';
import { cx } from './cx';

/**
 * AIが書いた日報(「事務局に送る文」「保護者に送る文」)。GAS版 #resultArea。
 * 保護者に送る文は「📋 コピーしてLINEに貼る」でコピーできる。
 */
export function DailyResult({
  shown,
  internalText,
  customerText,
  onChange,
}: {
  shown: boolean;
  internalText: string;
  customerText: string;
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
