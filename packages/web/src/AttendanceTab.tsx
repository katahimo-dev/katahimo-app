import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminTargetStaffSelector, useAdminTargetStaff } from './AdminTargetStaffContext';
import { fetchAttendanceMonth } from './api';
import { AttendanceCalendar } from './attendance/AttendanceCalendar';

function currentYearMonth(): string {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7); // 'YYYY-MM'
}

function formatMinutes(min: number | ''): string {
  if (min === '') return '-';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}時間${m}分`;
}

/** 「📊 月次集計」モーダル。GAS版のattendanceMonthlyModalと同じ役割・見た目。 */
function MonthlyModal({ staffId, onClose }: { staffId?: string; onClose: () => void }) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const monthQuery = useQuery({
    queryKey: ['attendance-month', yearMonth, staffId],
    queryFn: () => fetchAttendanceMonth(yearMonth, staffId),
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">📊 月次集計(勤怠)</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="monthlyMonth">
              対象月
            </label>
            <input
              id="monthlyMonth"
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded text-sm"
            />
          </div>

          {monthQuery.isPending && (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {monthQuery.data && (
            <ul className="text-sm text-gray-800 space-y-1 bg-gray-50 rounded-lg p-3">
              <li>入力済み日数: {monthQuery.data.days.length}</li>
              <li>労働時間合計: {formatMinutes(monthQuery.data.totals.laborMinutes)}</li>
              <li>残業時間合計: {formatMinutes(monthQuery.data.totals.overtimeMinutes)}</li>
              <li>移動時間合計: {formatMinutes(monthQuery.data.totals.totalMoveMin)}</li>
              <li>移動距離合計: {monthQuery.data.totals.totalDistanceKm}km</li>
              <li>基準距離超過回数合計: {monthQuery.data.totals.overThresholdCount}</li>
              <li>買物代行合計: {monthQuery.data.totals.shoppingErrandTotal}</li>
            </ul>
          )}
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-xl text-right">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 「勤怠」タブ。GAS版のtabPastSchedule(Googleカレンダー週間表示風UI+月次集計モーダル)と
 * 同じ見た目・操作感にしている(移行時の混乱を減らすため)。日々の労働時間・残業・移動距離・
 * 基準距離超過回数などの派生値は packages/core/src/domain/attendance/attendanceCalc.ts
 * (GAS版と数値一致を検証済み)で都度計算した結果を表示する。
 *
 * 管理者は「対象スタッフ」セレクタで他スタッフの勤怠を閲覧/編集できる
 * (packages/api/src/session.ts resolveAttendanceTargetStaffIdが、管理者以外の指定は
 * 常に無視して本人のstaffIdに強制する。GAS版PastSchedule.jsの対象スタッフセレクタと同じ役割)。
 * 選択はAdminTargetStaffContext経由で予定タブと共有される(GAS版のsharedAdminTargetStaffNameと同じ)。
 */
export function AttendanceTab() {
  const [showMonthly, setShowMonthly] = useState(false);
  const { effectiveStaffId } = useAdminTargetStaff();

  return (
    <div>
      <AdminTargetStaffSelector />

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setShowMonthly(true)}
          className="flex-1 py-2 rounded-xl text-sm font-bold border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
        >
          📊 月次集計
        </button>
      </div>

      <AttendanceCalendar staffId={effectiveStaffId} />

      {showMonthly && <MonthlyModal staffId={effectiveStaffId} onClose={() => setShowMonthly(false)} />}
    </div>
  );
}
