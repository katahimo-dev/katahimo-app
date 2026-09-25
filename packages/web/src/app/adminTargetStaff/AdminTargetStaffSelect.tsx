import { useEffect } from 'react';
import { useAdminTargetStaff } from './AdminTargetStaffProvider';

/**
 * 「表示するスタッフ」の選択欄(GAS版 #scheduleStaffField / #pastScheduleStaffField)。
 * 管理者のときだけ表示し、初めて表示したときに一覧を読み込む(GAS版 initScheduleStaffSelector_ /
 * initPastScheduleTab)。予定タブ・出勤簿タブのそれぞれ一番上に置く。
 */
export function AdminTargetStaffSelect({ id }: { id: string }) {
  const { isAdmin, staffList, targetStaffId, setTargetStaffId, requestStaffList } = useAdminTargetStaff();

  useEffect(() => {
    if (isAdmin) requestStaffList();
  }, [isAdmin, requestStaffList]);

  if (!isAdmin) return null;
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-base font-bold text-gray-700 mb-1">
        表示するスタッフ
      </label>
      <select
        id={id}
        value={targetStaffId}
        onChange={(e) => setTargetStaffId(e.target.value)}
        className="w-full p-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500"
      >
        {staffList.map((staff) => (
          <option key={staff.id} value={staff.id}>
            {staff.name}
          </option>
        ))}
      </select>
    </div>
  );
}
