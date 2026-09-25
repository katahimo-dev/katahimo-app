import type { AttendanceDay } from '@katahimo/shared';
import { ApiRequestError, userMessageOf } from '../../../api/client';
import { ErrorState, Loading } from '../../../ui/StatusViews';

/**
 * 1日表示の記録の上のお知らせ(GAS版 #pastScheduleResult): 読み込み中・読めなかった・
 * 直せない月の記録(「先月より前の記録は見るだけです…」)。
 */
export function DayStatus({
  day,
  isLoading,
  error,
}: {
  day: AttendanceDay | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  if (isLoading) return <Loading />;
  if (error) {
    // サーバーが理由を返したときはその理由(灰色)、通信の失敗は赤字(GAS版と同じ)
    if (error instanceof ApiRequestError) {
      return <div className="text-center text-gray-600 text-sm py-8">{userMessageOf(error)}</div>;
    }
    return <ErrorState message={userMessageOf(error)} />;
  }
  if (!day || day.editable) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg p-3 mb-3">
      先月より前の記録は見るだけです。直したいときは事務局へ連絡してください。（直せるのは {day.editableFrom}
      〜{day.editableTo}）
    </div>
  );
}
