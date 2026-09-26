import { isAdminRole } from '@katahimo/shared';
import { useSession } from '../../auth';
import { type AttendanceExportKind, fiscalYearOf, useAttendanceExport } from '../hooks/useAttendanceExport';

const BUTTON_CLASS =
  'min-h-12 py-3 px-3 bg-green-600 text-white text-base font-bold rounded-xl disabled:opacity-50 whitespace-nowrap';

/**
 * 今月のまとめの「Excelで保存」。選んだ月・その年度(4月〜3月)の出勤簿(計算式つき)と領収書を .xlsx で保存する。
 * 管理者には、その月に在籍している全員分(1人1シート)の「全員分をExcelで保存」も出す。
 */
export function ExcelExportButtons({ yearMonth }: { yearMonth: string }) {
  const { user } = useSession();
  const { busy, run } = useAttendanceExport();
  const label = (kind: AttendanceExportKind, text: string) => (busy === kind ? '保存しています…' : text);
  const fiscalYear = yearMonth ? fiscalYearOf(yearMonth) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run('month', yearMonth)}
          disabled={busy !== null}
          className={BUTTON_CLASS}
        >
          {label('month', '⬇ Excelで保存')}
        </button>
        <button
          type="button"
          onClick={() => void run('fiscalYear', yearMonth)}
          disabled={busy !== null}
          className="min-h-12 py-3 px-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl disabled:opacity-50 whitespace-nowrap"
        >
          {label('fiscalYear', fiscalYear ? `⬇ ${fiscalYear}年度分` : '⬇ 年度分')}
        </button>
        {isAdminRole(user.role) ? (
          <button
            type="button"
            onClick={() => void run('all', yearMonth)}
            disabled={busy !== null}
            className={BUTTON_CLASS}
          >
            {label('all', '⬇ 全員分をExcelで保存')}
          </button>
        ) : null}
      </div>
      <p className="text-sm text-gray-600">
        選んだ月の出勤簿(計算式つき)と領収書を Excel のファイルにします。年度分は4月〜3月の12か月です。
        {isAdminRole(user.role) ? '全員分は、その月にいる全員を1人1シートにまとめます。' : ''}
      </p>
    </div>
  );
}
