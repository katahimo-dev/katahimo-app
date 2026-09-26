import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { allStaffWorkbookSheets, buildAttendanceWorkbook, sheetLayoutOf } from './attendanceWorkbook';
import { exportStaffFixture, SAMPLE_RECEIPTS, SAMPLE_ROWS } from './attendanceWorkbook.fixture';

/**
 * 本物の表計算ソフト(LibreOffice Calc)で書き出した .xlsx を開いて計算させ、今月のまとめ(アプリの計算)と同じ値に
 * なることを確かめる。LibreOffice(soffice)の無い環境(CI 等)では飛ばす(式の計算は attendanceWorkbook.test.ts の
 * 評価器でも確かめている)。
 */
const SOFFICE_AVAILABLE = spawnSync('soffice', ['--version'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!SOFFICE_AVAILABLE)('出勤簿の Excel の書き出し(LibreOffice で計算)', () => {
  it('LibreOffice が計算した日ごと・月の合計・領収書の合計がアプリの値と同じ', async () => {
    const staff = [
      exportStaffFixture('山田 太郎', '2026-09', SAMPLE_ROWS, SAMPLE_RECEIPTS),
      exportStaffFixture('佐藤 花子', '2026-09', { '2026-09-10': SAMPLE_ROWS['2026-09-05'] ?? {} }),
    ];
    const dir = mkdtempSync(join(tmpdir(), 'katahimo-xlsx-'));
    try {
      const source = join(dir, 'in.xlsx');
      writeFileSync(source, await buildAttendanceWorkbook(allStaffWorkbookSheets(staff)));
      const out = join(dir, 'out');
      const result = spawnSync(
        'soffice',
        [
          `-env:UserInstallation=file://${join(dir, 'profile')}`,
          '--headless',
          '--convert-to',
          'xlsx',
          '--outdir',
          out,
          source,
        ],
        { encoding: 'utf8', timeout: 120_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(readFileSync(join(out, 'in.xlsx')) as unknown as ArrayBuffer);
      staff.forEach((s, i) => {
        const ws = workbook.worksheets[i] as ExcelJS.Worksheet;
        const month = s.months[0]?.month;
        if (!month) throw new Error('fixture');
        const layout = sheetLayoutOf(month.days.length, s.months[0]?.receipts.length ?? 0);
        const computed = (ref: string): number => {
          const value = ws.getCell(ref).value as { result?: unknown } | null;
          const v = value && typeof value === 'object' && 'result' in value ? value.result : value;
          return typeof v === 'number' ? v : 0;
        };
        month.days.forEach((day, index) => {
          const row = layout.firstDay + index;
          expect(computed(`AD${row}`), `${day.businessDate} AD`).toBeCloseTo(day.derived.laborMinutes, 6);
          expect(computed(`AE${row}`), `${day.businessDate} AE`).toBeCloseTo(day.derived.overtimeMinutes, 6);
          expect(computed(`AF${row}`)).toBeCloseTo(day.derived.totalMoveMin, 6);
          expect(computed(`AK${row}`)).toBeCloseTo(day.derived.totalDistanceKm, 6);
          expect(computed(`AL${row}`)).toBe(day.derived.overThresholdCount);
          expect(computed(`AM${row}`)).toBe(day.derived.visitCount);
          expect(computed(`AQ${row}`)).toBe(month.receipts.byDay[day.businessDate] ?? 0);
        });
        const t = layout.totals;
        expect(computed(`AD${t}`)).toBeCloseTo(month.totals.laborMinutes, 6);
        expect(computed(`AE${t}`)).toBeCloseTo(month.totals.overtimeMinutes, 6);
        expect(computed(`AP${t}`)).toBeCloseTo(month.totals.workedMinutes, 6);
        expect(computed(`AK${t}`)).toBeCloseTo(month.totals.totalDistanceKm, 6);
        expect(computed(`AL${t}`)).toBe(month.totals.overThresholdCount);
        expect(computed(`AM${t}`)).toBe(month.totals.visitCountTotal);
        expect(computed(`F${layout.receiptTotal}`)).toBe(month.receipts.total);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
