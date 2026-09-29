import { AdminTargetStaffSelect } from '../../app/adminTargetStaff';
import { useHomeTabs } from '../../app/homeTabs';
import { ScheduleDayToggle } from './ScheduleDayToggle';
import { ScheduleList } from './ScheduleList';
import { routeMetaText } from './scheduleDate';
import { useOpenReportFromSchedule } from './useOpenReportFromSchedule';
import { useScheduleView } from './useScheduleView';

/**
 * 「📅 今日の予定」タブ(GAS版 #tabSchedule)。
 * 表示するスタッフ(管理者のみ)・今日/明日の切り替え・予定の一覧(ルート・移動時間つき)・最新にする。
 */
export function ScheduleTab() {
  const { activeTab } = useHomeTabs();
  const view = useScheduleView({ active: activeTab === 'schedule' });
  const openReportFromSchedule = useOpenReportFromSchedule();

  return (
    <>
      <AdminTargetStaffSelect id="scheduleStaffSelect" />
      <ScheduleDayToggle offset={view.offset} onSelect={view.selectDay} />
      <div id="scheduleDateLabel" className="text-base font-bold text-gray-800 mb-2">
        {view.date.label}
      </div>
      <div id="scheduleList" className="space-y-3">
        <ScheduleList state={view.list} offset={view.offset} onWriteReport={openReportFromSchedule} />
      </div>
      {/* 予定は開いたとき・戻ってきたときに自動で最新を読み込むため、「最新にする」は目立たせず一覧の一番下に
          灰色で置く。いつの時点の情報か(裏で最新を確かめている間・確かめられなかったときはその旨も)は、
          そのすぐ上に出す(GAS版と同じ場所) */}
      <div id="scheduleRouteMeta" className="text-sm text-gray-600 mt-4 mb-2 text-center min-h-[1rem]">
        {routeMetaText(view.routeFetchedAt, view.routeFreshness)}
      </div>
      <button
        type="button"
        id="scheduleRouteBtn"
        onClick={view.refreshRoute}
        disabled={view.routeLoading}
        className="w-full min-h-12 py-3 rounded-xl text-base font-bold bg-gray-200 text-gray-800 transition-colors"
      >
        {view.routeBlocking ? '調べています…（10秒ほど）' : '🔄 最新にする'}
      </button>
    </>
  );
}
