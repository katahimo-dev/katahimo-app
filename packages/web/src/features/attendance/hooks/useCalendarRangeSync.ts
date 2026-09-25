import { useCallback, useRef, useState } from 'react';
import { calendarSyncApi } from '../../../api/calendarSync';
import { ApiRequestError } from '../../../api/client';
import { showToast } from '../../../ui/toast';
import {
  buildSyncTargets,
  failedTargets,
  runSyncQueue,
  type SyncApplyResult,
  type SyncProgress,
  type SyncStaff,
  type SyncTarget,
  syncDoneMessage,
  validateSyncRange,
} from '../model/rangeSync';

/**
 * 管理者の「まとめて取り込む」の状態(GAS版 calendarSyncRunning / calendarSyncLastFailedTargets /
 * calendarSyncStaffCheckState / runCalendarSyncQueue)。ダイアログを閉じても取り込みは裏で続き、
 * 開き直すと進みぐあいがそのまま見える(タブ側で持つ)。
 */
export function useCalendarRangeSync({ onFinished }: { onFinished: (allSucceeded: boolean) => void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [failed, setFailed] = useState<SyncTarget[]>([]);
  /** スタッフごとのチェック(未設定 = チェックあり。開き直しても残る) */
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  const runningRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const isChecked = useCallback((staffId: string) => !unchecked[staffId], [unchecked]);
  const setChecked = useCallback((staffId: string, checked: boolean) => {
    setUnchecked((u) => ({ ...u, [staffId]: !checked }));
  }, []);
  const setAllChecked = useCallback((staff: readonly SyncStaff[], checked: boolean) => {
    setUnchecked((u) => ({ ...u, ...Object.fromEntries(staff.map((s) => [s.id, !checked])) }));
  }, []);

  /** ダイアログを開いたとき(取り込み中でなければ、前回の進みぐあいを消す) */
  const resetIfIdle = useCallback(() => {
    if (runningRef.current) return;
    setProgress(null);
    setFailed([]);
  }, []);

  const execute = useCallback(async (targets: SyncTarget[], kind: 'run' | 'retry') => {
    runningRef.current = true;
    setRunning(true);
    const apply = async (t: SyncTarget): Promise<SyncApplyResult> => {
      try {
        const res = await calendarSyncApi.apply({ date: t.date, staffId: t.staff.id });
        return { ok: true, appointmentCount: res.appointmentCount };
      } catch (e) {
        // サーバーが理由を返した失敗は「できなかった」、それ以外(通信の失敗)は例外のまま数える
        if (e instanceof ApiRequestError) return { ok: false, message: e.message };
        throw e;
      }
    };
    const summary = await runSyncQueue(targets, apply, setProgress);
    runningRef.current = false;
    setRunning(false);
    setFailed(failedTargets(summary));
    showToast(syncDoneMessage(kind, summary), summary.failed > 0);
    onFinishedRef.current(summary.failed === 0);
  }, []);

  /** 「取り込む」 */
  const run = useCallback(
    (startDate: string, endDate: string, staff: readonly SyncStaff[]) => {
      if (runningRef.current) return;
      const selected = staff.filter((s) => !unchecked[s.id]);
      const invalid = validateSyncRange(startDate, endDate, selected.length);
      if (invalid) {
        showToast(invalid, true);
        return;
      }
      void execute(buildSyncTargets(startDate, endDate, selected), 'run');
    },
    [execute, unchecked],
  );

  /** 「できなかった分だけやり直す」 */
  const retryFailed = useCallback(() => {
    if (runningRef.current || failed.length === 0) return;
    void execute(failed, 'retry');
  }, [execute, failed]);

  return {
    running,
    progress,
    canRetry: failed.length > 0,
    isChecked,
    setChecked,
    setAllChecked,
    resetIfIdle,
    run,
    retryFailed,
  };
}

export type CalendarRangeSync = ReturnType<typeof useCalendarRangeSync>;
