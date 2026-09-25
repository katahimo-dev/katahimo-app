import type { ReportMode } from '../model/reportForm';
import { cx } from './cx';

const TAB_BASE = 'flex-1 min-h-12 py-3 text-base font-bold';
const INACTIVE = 'text-gray-600 border-b-2 border-transparent';

/** 「📝 今日の日報」「⚠️ 事故・ヒヤリ」の切り替え(GAS版 #modalTabs / switchMode)。選んでいるほうは青/赤。 */
export function ModeTabs({
  mode,
  hidden,
  onSwitch,
}: {
  mode: ReportMode;
  hidden: boolean;
  onSwitch: (mode: ReportMode) => void;
}) {
  return (
    <div
      className={cx('flex border-b border-gray-200', hidden && 'hidden')}
      id="modalTabs"
      role="tablist"
      aria-label="報告の種類"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'daily'}
        onClick={() => onSwitch('daily')}
        id="tabDaily"
        className={cx(
          TAB_BASE,
          mode === 'daily' ? 'text-blue-600 border-b-2 border-blue-600' : INACTIVE,
          'transition-colors',
        )}
      >
        📝 今日の日報
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'accident'}
        onClick={() => onSwitch('accident')}
        id="tabAccident"
        className={cx(
          TAB_BASE,
          mode === 'accident' ? 'text-red-600 border-b-2 border-red-600' : INACTIVE,
          'transition-colors',
        )}
      >
        ⚠️ 事故・ヒヤリ
      </button>
    </div>
  );
}
