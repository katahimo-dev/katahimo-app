import { useCallback } from 'react';
import { attendanceApi } from '../../../api/attendance';
import type { DownloadedFile } from '../../../api/client';
import { useFileDownload } from '../../../lib/useFileDownload';
import { showToast } from '../../../ui/toast';
import { useAttendanceTarget } from './attendanceQueries';

/** 保存するもの: 選んだ月・その月の年度(4月〜3月)・その月の全員分(管理者だけ)。 */
export type AttendanceExportKind = 'month' | 'fiscalYear' | 'all';

/** 'YYYY-MM' の年度(4月始まり)。 */
export function fiscalYearOf(yearMonth: string): number {
  const year = Number(yearMonth.slice(0, 4));
  return Number(yearMonth.slice(5, 7)) >= 4 ? year : year - 1;
}

/**
 * 出勤簿の Excel の保存。対象は「表示するスタッフ」(管理者・コーディネーター)または本人。保存している間は
 * 同じボタンを押しても2回目は送らない。失敗はサーバーの理由を赤いお知らせで出す(回数の上限は「あと約N分」つき)。
 */
export function useAttendanceExport() {
  const { staffId } = useAttendanceTarget();
  const { busy, run: download } = useFileDownload<AttendanceExportKind>();

  const run = useCallback(
    async (kind: AttendanceExportKind, yearMonth: string) => {
      if (!yearMonth) {
        showToast('月を選んでください', true);
        return;
      }
      await download(
        kind,
        (): Promise<DownloadedFile> => {
          if (kind === 'all') return attendanceApi.exportAll(yearMonth);
          if (kind === 'fiscalYear')
            return attendanceApi.exportStaff({ fiscalYear: fiscalYearOf(yearMonth) }, staffId);
          return attendanceApi.exportStaff({ month: yearMonth }, staffId);
        },
        'Excelファイルを保存しました',
      );
    },
    [staffId, download],
  );

  return { busy, run };
}
