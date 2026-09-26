import { useCallback, useRef, useState } from 'react';
import { attendanceApi } from '../../../api/attendance';
import type { DownloadedFile } from '../../../api/client';
import { saveBlobAsFile } from '../../../lib/saveFile';
import { showErrorToast, showToast } from '../../../ui/toast';
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
  const [busy, setBusy] = useState<AttendanceExportKind | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (kind: AttendanceExportKind, yearMonth: string) => {
      if (busyRef.current) return;
      if (!yearMonth) {
        showToast('月を選んでください', true);
        return;
      }
      busyRef.current = true;
      setBusy(kind);
      try {
        let file: DownloadedFile;
        if (kind === 'all') file = await attendanceApi.exportAll(yearMonth);
        else if (kind === 'fiscalYear')
          file = await attendanceApi.exportStaff({ fiscalYear: fiscalYearOf(yearMonth) }, staffId);
        else file = await attendanceApi.exportStaff({ month: yearMonth }, staffId);
        saveBlobAsFile(file.blob, file.filename);
        showToast('Excelファイルを保存しました');
      } catch (error) {
        showErrorToast(error);
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [staffId],
  );

  return { busy, run };
}
