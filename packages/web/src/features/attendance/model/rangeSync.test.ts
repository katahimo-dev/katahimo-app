import { describe, expect, it } from 'vitest';
import {
  buildSyncTargets,
  failedTargets,
  progressPercent,
  progressStatsText,
  runSyncQueue,
  type SyncProgress,
  syncDoneMessage,
  validateSyncRange,
} from './rangeSync';

const A = { id: 'a', name: '佐藤' };
const B = { id: 'b', name: '鈴木' };

describe('まとめて取り込む', () => {
  it('日ごとにスタッフを並べる(両端を含む・月をまたぐ)', () => {
    expect(
      buildSyncTargets('2026-08-31', '2026-09-01', [A, B]).map((t) => `${t.date}:${t.staff.id}`),
    ).toEqual(['2026-08-31:a', '2026-08-31:b', '2026-09-01:a', '2026-09-01:b']);
    expect(buildSyncTargets('2026-09-02', '2026-09-01', [A])).toEqual([]);
  });
  it('入力の確認', () => {
    expect(validateSyncRange('', '2026-09-01', 1)).toBe('始めの日と終わりの日を選んでください');
    expect(validateSyncRange('2026-09-02', '2026-09-01', 1)).toBe(
      '終わりの日は、始めの日より後にしてください',
    );
    expect(validateSyncRange('2026-09-01', '2026-09-01', 0)).toBe('スタッフを1人以上選んでください');
    expect(validateSyncRange('2026-09-01', '2026-09-01', 1)).toBeNull();
  });
  it('1件ずつ順に取り込み、失敗(理由あり・通信)も数えて続ける。やり直しは失敗分だけ', async () => {
    const targets = buildSyncTargets('2026-09-01', '2026-09-02', [A, B]);
    const order: string[] = [];
    const progress: SyncProgress[] = [];
    const summary = await runSyncQueue(
      targets,
      async (t) => {
        order.push(`${t.date}:${t.staff.id}`);
        if (t.staff.id === 'b' && t.date === '2026-09-01')
          return { ok: false, message: 'カレンダーを読めません' };
        if (t.staff.id === 'b') throw new Error('offline');
        return { ok: true, appointmentCount: 2 };
      },
      (p) => progress.push(p),
    );
    expect(order).toEqual(['2026-09-01:a', '2026-09-01:b', '2026-09-02:a', '2026-09-02:b']);
    expect(summary).toMatchObject({ succeeded: 2, failed: 2, appointmentCount: 4 });
    expect(summary.details.filter((d) => !d.success).map((d) => d.error)).toEqual([
      'カレンダーを読めません',
      'サーバー接続エラー: offline',
    ]);
    expect(progress[0]).toEqual({
      completed: 0,
      total: 4,
      succeeded: 0,
      failed: 0,
      label: 'いま: 2026-09-01 佐藤',
    });
    expect(progress.at(-1)).toEqual({
      completed: 4,
      total: 4,
      succeeded: 2,
      failed: 2,
      label: 'できませんでした: 2026-09-02 鈴木',
    });
    expect(progressPercent({ completed: 1, total: 3 })).toBe(33);
    expect(progressStatsText(progress.at(-1) as SyncProgress)).toBe(
      'おわり 4/4（できた 2 / できなかった 2）',
    );
    expect(failedTargets(summary)).toEqual([
      { date: '2026-09-01', staff: B },
      { date: '2026-09-02', staff: B },
    ]);
    expect(syncDoneMessage('retry', summary)).toBe('やり直し終わりました。できた 2件 / できなかった 2件');
  });
});
