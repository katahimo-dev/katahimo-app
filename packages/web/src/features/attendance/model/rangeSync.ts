import { addDaysYmd } from './week';

/**
 * 管理者の「まとめて取り込む」(GAS版 buildCalendarSyncTargets_ / runCalendarSyncQueue)。
 * スタッフ×日ごとに1件ずつ順に取り込み、できた/できなかった数を数える。
 */

export interface SyncStaff {
  id: string;
  name: string;
}

export interface SyncTarget {
  date: string;
  staff: SyncStaff;
}

export interface SyncResultDetail extends SyncTarget {
  success: boolean;
  error?: string;
}

export interface SyncProgress {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  /** 「いま: 2026-09-25 佐藤 美咲」など */
  label: string;
}

export interface SyncSummary {
  succeeded: number;
  failed: number;
  appointmentCount: number;
  details: SyncResultDetail[];
}

/** 始めの日〜終わりの日(両端を含む)× スタッフ。日ごとにスタッフを並べる(GAS版と同じ順)。 */
export function buildSyncTargets(
  startDate: string,
  endDate: string,
  staff: readonly SyncStaff[],
): SyncTarget[] {
  const targets: SyncTarget[] = [];
  for (let d = startDate; d <= endDate; d = addDaysYmd(d, 1)) {
    for (const s of staff) targets.push({ date: d, staff: s });
  }
  return targets;
}

/** 始めの日・終わりの日・スタッフの確認。問題があればお知らせの文言、無ければ null。 */
export function validateSyncRange(startDate: string, endDate: string, staffCount: number): string | null {
  if (!startDate || !endDate) return '始めの日と終わりの日を選んでください';
  if (startDate > endDate) return '終わりの日は、始めの日より後にしてください';
  if (staffCount === 0) return 'スタッフを1人以上選んでください';
  return null;
}

export function progressPercent(p: Pick<SyncProgress, 'completed' | 'total'>): number {
  return p.total === 0 ? 0 : Math.round((p.completed / p.total) * 100);
}

export function progressStatsText(p: SyncProgress): string {
  return `おわり ${p.completed}/${p.total}（できた ${p.succeeded} / できなかった ${p.failed}）`;
}

/** 1件分の取り込みの結果。`ok: false` はサーバーが理由を返した失敗、例外は通信の失敗。 */
export type SyncApplyResult = { ok: true; appointmentCount: number } | { ok: false; message: string };

/**
 * 順に1件ずつ取り込む。進みぐあいは1件の前後で onProgress に渡す。
 * 例外(通信の失敗)も「できなかった」に数えて続ける。
 */
export async function runSyncQueue(
  targets: readonly SyncTarget[],
  apply: (target: SyncTarget) => Promise<SyncApplyResult>,
  onProgress: (progress: SyncProgress) => void,
): Promise<SyncSummary> {
  const summary: SyncSummary = { succeeded: 0, failed: 0, appointmentCount: 0, details: [] };
  const report = (completed: number, label: string) =>
    onProgress({
      completed,
      total: targets.length,
      succeeded: summary.succeeded,
      failed: summary.failed,
      label,
    });

  for (const [index, target] of targets.entries()) {
    const who = `${target.date} ${target.staff.name}`;
    report(index, `いま: ${who}`);
    try {
      const res = await apply(target);
      if (res.ok) {
        summary.succeeded++;
        summary.appointmentCount += Number(res.appointmentCount || 0);
        summary.details.push({ ...target, success: true });
      } else {
        summary.failed++;
        summary.details.push({ ...target, success: false, error: res.message || '取り込めませんでした' });
      }
      report(index + 1, `おわり: ${who}`);
    } catch (e) {
      summary.failed++;
      summary.details.push({
        ...target,
        success: false,
        error: `サーバー接続エラー: ${e instanceof Error ? e.message : String(e)}`,
      });
      report(index + 1, `できませんでした: ${who}`);
    }
  }
  return summary;
}

/** やり直す分(できなかったものだけ) */
export function failedTargets(summary: SyncSummary): SyncTarget[] {
  return summary.details.filter((d) => !d.success).map(({ date, staff }) => ({ date, staff }));
}

/** 終わったときのお知らせ */
export function syncDoneMessage(kind: 'run' | 'retry', summary: Pick<SyncSummary, 'succeeded' | 'failed'>) {
  const head = kind === 'run' ? '取り込み終わりました。' : 'やり直し終わりました。';
  return `${head}できた ${summary.succeeded}件 / できなかった ${summary.failed}件`;
}
