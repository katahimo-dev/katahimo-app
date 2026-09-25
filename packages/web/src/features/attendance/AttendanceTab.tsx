import { AdminTargetStaffSelect } from '../../app/adminTargetStaff';
import { Placeholder } from '../../ui/Placeholder';

/**
 * 「🕒 出勤簿」タブ(GAS版 #tabPastSchedule)と、その中のダイアログ(今月のまとめ・まとめて取り込む・
 * カレンダーとの見比べ・予定の修正)。GAS版と同じく、初めてタブを開いたときに作られる(AppShell)。
 * 担当: 出勤簿の担当(packages/web/README.md「機能ごとの担当」)。ここは仮置き。
 */
export function AttendanceTab() {
  return (
    <>
      <AdminTargetStaffSelect id="pastScheduleStaffSelect" />
      <Placeholder title="出勤簿" />
    </>
  );
}
