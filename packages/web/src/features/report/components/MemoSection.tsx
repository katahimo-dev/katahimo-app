import type { Ref } from 'react';
import type { AccidentType, ReportMode } from '../model/reportForm';
import { cx } from './cx';

interface MemoSectionProps {
  hidden: boolean;
  mode: ReportMode;
  memo: string;
  placeholder: string;
  accidentType: AccidentType;
  listening: boolean;
  warnings: string | null;
  warningsRef: Ref<HTMLDivElement>;
  onMemoChange: (value: string) => void;
  onAccidentTypeChange: (value: AccidentType) => void;
  onOpenHint: () => void;
  onToggleVoice: () => void;
}

const ACCIDENT_TYPES: { value: AccidentType; inputClass: string }[] = [
  { value: '事故報告', inputClass: 'w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300' },
  { value: 'ヒヤリハット', inputClass: 'w-4 h-4 text-orange-500 focus:ring-orange-400 border-gray-300' },
];

/**
 * 今日の出来事メモ(日報・事故で1つの欄を共有する)。事故のときは種類の選択と「💡 書き方のヒント」を出す。
 * GAS版 #modalInputSection。
 */
export function MemoSection({
  hidden,
  mode,
  memo,
  placeholder,
  accidentType,
  listening,
  warnings,
  warningsRef,
  onMemoChange,
  onAccidentTypeChange,
  onOpenHint,
  onToggleVoice,
}: MemoSectionProps) {
  const isAccident = mode === 'accident';
  return (
    <div id="modalInputSection" className={cx(hidden && 'hidden')}>
      <div id="accidentTypeSelector" className={cx(!isAccident && 'hidden', 'mb-2')}>
        <div className="flex gap-4 p-2 bg-gray-50 rounded-lg border border-gray-100">
          {ACCIDENT_TYPES.map((t) => (
            <label key={t.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="accType"
                value={t.value}
                checked={accidentType === t.value}
                onChange={() => onAccidentTypeChange(t.value)}
                className={t.inputClass}
              />
              <span className="text-sm font-bold text-gray-700">{t.value}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center gap-3 mb-1">
        <label htmlFor="reportInput" className="block text-base font-bold text-gray-700">
          今日の出来事メモ
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onOpenHint}
            id="hintBtn"
            className={cx(
              !isAccident && 'hidden',
              'min-h-11 text-sm bg-gray-200 text-gray-800 px-3 py-2 rounded-xl flex items-center gap-1 transition-colors',
            )}
          >
            💡 書き方のヒント
          </button>
          <button
            type="button"
            onClick={onToggleVoice}
            id="micBtn"
            className={cx(
              'min-h-11 text-sm bg-gray-200 text-gray-800 px-3 py-2 rounded-xl flex items-center gap-1 transition-colors whitespace-nowrap',
              listening && 'bg-red-100 text-red-700',
            )}
          >
            {listening ? (
              <>
                <span className="animate-pulse">⏹</span> <span>止める（聞いています…）</span>
              </>
            ) : (
              <>
                <span id="micIcon">🎤</span> <span>話して入力</span>
              </>
            )}
          </button>
        </div>
      </div>
      <textarea
        id="reportInput"
        rows={6}
        value={memo}
        placeholder={placeholder}
        onChange={(e) => onMemoChange(e.target.value)}
        className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 transition-all resize-none text-base"
      />

      <div
        id="warningsArea"
        ref={warningsRef}
        className={cx(
          warnings === null && 'hidden',
          'mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-base text-yellow-700',
        )}
      >
        <strong>⚠️ 足りない情報があります：</strong> <span id="warningsList">{warnings}</span>
      </div>
    </div>
  );
}
