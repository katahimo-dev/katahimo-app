import { readFileSync } from 'node:fs';
import { createTestContext } from '@katahimo/core/test-utils';
import { getAttendanceDay, importAttendanceSheetRows } from '@katahimo/core/usecases';
import { describe, expect, it } from 'vitest';
import { parseAttendanceSheetCsv } from './parse';

const fixture = readFileSync(new URL('./__fixtures__/attendance_2026_09.csv', import.meta.url), 'utf8');

describe('parseAttendanceSheetCsv(個別出勤簿の月のシートの CSV)', () => {
  it('A列が日付の行だけを読み、入力列(C〜AO)を列の定義の位置から取り出す(数式の列は読まない)', () => {
    const parsed = parseAttendanceSheetCsv(fixture);
    expect(parsed.rows.map((r) => [r.rowNumber, r.businessDate])).toEqual([
      [4, '2026-09-01'],
      [5, '2026-09-02'],
      [6, '2026-09-03'],
      [7, '2026-09-04'],
    ]);
    expect(parsed.ignoredRowCount).toBe(4);
    expect(parsed.rows[0]?.rowData).toMatchObject({
      C: '佐藤様',
      D: '9:00',
      E: '12:00',
      H: '20',
      I: '晴れ',
      AG: '5.5',
      AI: '3.2',
      AJ: '4',
      AO: '雨のため遅延',
      X: '',
    });
    expect(Object.keys(parsed.rows[0]?.rowData ?? {})).toHaveLength(25);
  });

  it('年の無い日付は year を使い、存在しない日付は読まない', () => {
    const csv = '9/1,,佐藤様\n9月2日,,田中様\n2026/02/30,,x\n';
    expect(parseAttendanceSheetCsv(csv).rows).toEqual([]);
    expect(parseAttendanceSheetCsv(csv, { year: 2026 }).rows.map((r) => r.businessDate)).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
  });
});

describe('importAttendanceSheetRows(既存の出勤簿の取込)', () => {
  it('1日ずつ実体に取り込み、読めないセルだけ飛ばし、ミラーは積まない。再実行は何も書かない', async () => {
    const ctx = createTestContext();
    const { actor } = await ctx.addStaff('山田 太郎', 'taro@example.com');
    const { rows } = parseAttendanceSheetCsv(fixture);
    const result = await importAttendanceSheetRows(ctx.deps, ctx.tenantId, actor.staffId, rows);
    expect(result).toMatchObject({ imported: 3, unchanged: 1, failed: [] });
    expect(result.skippedCells).toEqual([expect.objectContaining({ rowNumber: 7, column: 'M' })]);
    const day = await getAttendanceDay(ctx.deps, actor, actor.staffId, '2026-09-01');
    expect(day.rowData).toEqual({
      C: '佐藤様',
      D: '09:00',
      E: '12:00',
      AI: '3.20',
      I: '晴れ',
      H: '20',
      L: '田中様',
      M: '13:00',
      N: '15:00',
      AG: '5.50',
      AJ: '4.00',
      AO: '雨のため遅延',
    });
    expect(day.changedFields).toEqual([]);
    expect(ctx.data().days).toHaveLength(3);
    expect(ctx.data().outbox).toEqual([]);
    expect(ctx.data().entityChanges.every((c) => c.changeSource === 'import')).toBe(true);
    expect(ctx.data().visits.every((v) => v.source === 'manual')).toBe(true);

    const again = await importAttendanceSheetRows(ctx.deps, ctx.tenantId, actor.staffId, rows);
    expect(again).toMatchObject({ imported: 0, unchanged: 4 });
  });
});
