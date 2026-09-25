import type { CalendarSyncPreviewResponse } from '@katahimo/shared';
import { useMutation } from '@tanstack/react-query';
import { calendarSyncApi } from '../../../api/calendarSync';
import { ModalHeader } from '../../../ui/modal';
import { showErrorToast, showToast } from '../../../ui/toast';
import { buildDiffRows, diffCountText } from '../model/diff';
import { Dialog } from './Dialog';

/**
 * 「カレンダーと違うところ」(GAS版 #calendarSyncDiffModal / confirmCalendarSyncDiff)。
 * 「取り込む」を押すと、その日のカレンダーの内容を出勤簿へ取り込む(サーバーが計算し直してから書く)。
 */
export function CalendarSyncDiffModal({
  preview,
  staffId,
  onClose,
  onApplied,
}: {
  preview: CalendarSyncPreviewResponse;
  staffId: string | undefined;
  onClose: () => void;
  onApplied: () => void;
}) {
  const apply = useMutation({
    mutationFn: () => calendarSyncApi.apply({ date: preview.date, staffId }),
    onSuccess: (res) => {
      onClose();
      showToast(`カレンダーの内容を取り込みました（${res.changedCount}件）`);
      onApplied();
    },
    onError: (e) => showErrorToast(e),
  });

  return (
    <Dialog
      open
      labelledBy="calendarSyncDiffTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[115] flex items-center justify-center p-4"
    >
      <div className="bg-white w-full max-w-sm rounded-2xl border border-gray-200 flex flex-col max-h-[85vh]">
        <ModalHeader title="カレンダーと違うところ" titleId="calendarSyncDiffTitle" onClose={onClose} />
        <div className="p-4 overflow-y-auto">
          <p className="text-base text-gray-700 mb-2">「取り込む」を押すと、下の項目だけが書きかわります。</p>
          <div className="text-sm text-gray-600 mb-2">
            {diffCountText(preview.appointmentCount, preview.changes.length)}
          </div>
          <div>
            {buildDiffRows(preview.changes).map((row) => (
              <div key={row.key} className="border-b border-gray-100 py-2 text-sm">
                <div className="font-bold text-gray-700">{row.label}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-gray-600 line-through">{row.oldText}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-blue-700 font-bold">{row.newText}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-2xl flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={apply.isPending}
            className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
          >
            {apply.isPending ? '取り込んでいます…' : '取り込む'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
