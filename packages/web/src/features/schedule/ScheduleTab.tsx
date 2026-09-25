import { AdminTargetStaffSelect } from '../../app/adminTargetStaff';
import { Placeholder } from '../../ui/Placeholder';

/**
 * 「📅 今日の予定」タブ(GAS版 #tabSchedule)。
 * 担当: 予定・お客様の担当(packages/web/README.md「機能ごとの担当」)。ここは仮置き。
 */
export function ScheduleTab() {
  return (
    <>
      <AdminTargetStaffSelect id="scheduleStaffSelect" />
      <Placeholder title="今日の予定" />
    </>
  );
}
