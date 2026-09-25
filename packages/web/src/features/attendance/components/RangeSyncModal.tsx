import { useEffect, useState } from 'react';
import { useAdminTargetStaff } from '../../../app/adminTargetStaff';
import { ModalHeader } from '../../../ui/modal';
import type { CalendarRangeSync } from '../hooks/useCalendarRangeSync';
import { progressPercent, progressStatsText } from '../model/rangeSync';
import { Dialog } from './Dialog';

/**
 * 管理者用「まとめて取り込む日とスタッフを選ぶ」(GAS版 #calendarSyncModal)。
 * 始めの日〜終わりの日 × チェックしたスタッフを1件ずつ取り込み、進みぐあいを出す。
 */
export function RangeSyncModal({
  open,
  defaultDate,
  sync,
  onClose,
}: {
  open: boolean;
  /** 開いたときの始めの日・終わりの日(選んでいる日) */
  defaultDate: string;
  sync: CalendarRangeSync;
  onClose: () => void;
}) {
  const { staffList } = useAdminTargetStaff();
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const { resetIfIdle } = sync;

  // 開くたびに日付を選んでいる日に戻し、取り込み中でなければ前回の進みぐあいを消す(GAS版 openCalendarSyncRangeModal)
  useEffect(() => {
    if (!open) return;
    setStartDate(defaultDate);
    setEndDate(defaultDate);
    resetIfIdle();
  }, [open, defaultDate, resetIfIdle]);

  const { progress } = sync;

  return (
    <Dialog
      open={open}
      labelledBy="calendarSyncTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4"
    >
      <div className="bg-white w-full max-w-sm rounded-2xl border border-gray-200 flex flex-col max-h-[85vh]">
        <ModalHeader
          title="まとめて取り込む日とスタッフを選ぶ"
          titleId="calendarSyncTitle"
          onClose={onClose}
        />
        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-sm text-gray-600">
            始めの日と終わりの日を選び、チェックしたスタッフの出勤簿をまとめて最新にします。古い月でも取り込めます。
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="calendarSyncStartDate" className="block text-base font-bold text-gray-700 mb-1">
                始めの日
              </label>
              <input
                type="date"
                id="calendarSyncStartDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-xl text-base"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="calendarSyncEndDate" className="block text-base font-bold text-gray-700 mb-1">
                終わりの日
              </label>
              <input
                type="date"
                id="calendarSyncEndDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-xl text-base"
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center gap-3 mb-1">
              <span className="block text-base font-bold text-gray-700">スタッフ（チェックした人だけ）</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => sync.setAllChecked(staffList, true)}
                  className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold"
                >
                  全部選ぶ
                </button>
                <button
                  type="button"
                  onClick={() => sync.setAllChecked(staffList, false)}
                  className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold"
                >
                  全部はずす
                </button>
              </div>
            </div>
            <div className="border border-gray-200 rounded-xl p-2 max-h-40 overflow-y-auto space-y-1">
              {staffList.map((staff) => (
                <label key={staff.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sync.isChecked(staff.id)}
                    onChange={(e) => sync.setChecked(staff.id, e.target.checked)}
                  />
                  <span>{staff.name}</span>
                </label>
              ))}
            </div>
          </div>
          {progress ? (
            <div>
              <p className="text-base font-bold text-gray-700 mb-1">いまの進みぐあい</p>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-2 bg-blue-600" style={{ width: `${progressPercent(progress)}%` }} />
              </div>
              <div className="text-sm text-gray-600 mt-1">{progressStatsText(progress)}</div>
              <div className="text-sm text-gray-600">{progress.label}</div>
            </div>
          ) : null}
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-2xl flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sync.running}
            className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-sm font-bold rounded-xl"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={sync.retryFailed}
            disabled={sync.running || !sync.canRetry}
            className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-sm font-bold rounded-xl disabled:opacity-50"
          >
            できなかった分だけやり直す
          </button>
          <button
            type="button"
            onClick={() => sync.run(startDate, endDate, staffList)}
            disabled={sync.running}
            className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl"
          >
            取り込む
          </button>
        </div>
      </div>
    </Dialog>
  );
}
