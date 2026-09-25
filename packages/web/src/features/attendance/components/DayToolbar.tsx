import { useState } from 'react';
import { isSlotFilled, SLOT_DEFS, type SlotKey, type SlotValues } from '../model/dayRecord';

/**
 * 1日表示の上のボタン(GAS版 #calBackToWeekRow): 「← 週の一覧へ」「🔄 最新にする」
 * 「✏️ 記録を直す・足す」(直せる日だけ。予定ごとに ✅/➕ を並べたメニュー)。
 */
export function DayToolbar({
  refreshing,
  onBack,
  onRefresh,
  editableSlots,
  onOpenSlot,
}: {
  refreshing: boolean;
  onBack: () => void;
  onRefresh: () => void;
  /** 直せる日のときだけ、その日の予定(メニューの中身)。直せない・読み込み前は null */
  editableSlots: Record<SlotKey, SlotValues> | null;
  onOpenSlot: (key: SlotKey) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div id="calBackToWeekRow" className="mb-2">
      <div className="mb-1.5">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold"
        >
          ← 週の一覧へ
        </button>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {/* 「最新にする」と「カレンダーと見比べる」は1つのボタン(出勤簿を読み直したあと、続けてカレンダーと見比べる) */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="min-h-12 py-2 px-3 rounded-xl text-sm font-bold bg-gray-200 text-gray-800 transition-colors whitespace-nowrap"
        >
          {refreshing ? '調べています…' : '🔄 最新にする'}
        </button>
        <div className="relative">
          {editableSlots ? (
            <>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="min-h-12 py-2 px-3 rounded-xl text-sm font-bold bg-blue-600 text-white transition-colors whitespace-nowrap"
              >
                ✏️ 記録を直す・足す
              </button>
              {menuOpen ? (
                <AddSlotMenu
                  slots={editableSlots}
                  onSelect={(key) => {
                    setMenuOpen(false);
                    onOpenSlot(key);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 訪問1〜3件目・事務作業1〜2つ目のメニュー(GAS版 updateAddSlotButtonState_)。 */
function AddSlotMenu({
  slots,
  onSelect,
}: {
  slots: Record<SlotKey, SlotValues>;
  onSelect: (key: SlotKey) => void;
}) {
  return (
    <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[150px] py-1">
      {SLOT_DEFS.map((def) => {
        const slot = slots[def.key];
        const filled = isSlotFilled(slot);
        return (
          <button
            key={def.key}
            type="button"
            onClick={() => onSelect(def.key)}
            className="w-full text-left min-h-12 px-3 py-3 text-base active:bg-blue-50 flex items-center gap-1.5"
          >
            <span>{filled ? '✅' : '➕'}</span>
            <span className={filled ? 'text-gray-700 font-bold' : 'text-gray-600'}>{def.label}</span>
            <span className="text-sm text-gray-600 truncate">
              {filled ? `${slot.name} ${slot.start}〜${slot.end}` : 'まだありません'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
