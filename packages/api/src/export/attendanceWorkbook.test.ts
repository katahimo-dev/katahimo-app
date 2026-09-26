import { inflateRawSync } from 'node:zlib';
import { ATTENDANCE_COLUMN_KEYS, type AttendanceRowData, computeDayDerived } from '@katahimo/core/domain';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  allStaffWorkbookSheets,
  buildAttendanceWorkbook,
  sheetLayoutOf,
  staffWorkbookSheets,
} from './attendanceWorkbook';
import { exportStaffFixture, SAMPLE_RECEIPTS, SAMPLE_ROWS } from './attendanceWorkbook.fixture';
import { createFormulaEvaluator } from './testFormulaEvaluator';

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

const formulaOf = (ws: ExcelJS.Worksheet, ref: string): string | undefined => {
  const value = ws.getCell(ref).value as { formula?: string } | null;
  return value && typeof value === 'object' ? value.formula : undefined;
};

/** 日の行で、アプリの計算(computeDayDerived)と比べる列。 */
const DAY_CHECKS = [
  ['AD', 'laborMinutes'],
  ['AE', 'overtimeMinutes'],
  ['AF', 'totalMoveMin'],
  ['AK', 'totalDistanceKm'],
  ['AL', 'overThresholdCount'],
  ['AM', 'visitCount'],
  ['AP', 'workedMinutes'],
] as const;

/** 合計の行で、アプリの月合計(computeMonthlyTotals)と比べる列。 */
const TOTAL_CHECKS = [
  ['AD', 'laborMinutes'],
  ['AE', 'overtimeMinutes'],
  ['AF', 'totalMoveMin'],
  ['AK', 'totalDistanceKm'],
  ['AL', 'overThresholdCount'],
  ['AM', 'visitCountTotal'],
  ['AN', 'shoppingErrandTotal'],
  ['AP', 'workedMinutes'],
] as const;

/**
 * 書き出したファイルの中の、式のセルの結果の値(`<c r="F4"><f>…</f><v>0.4</v></c>` の v)。exceljs は読むときに
 * 0 の結果を捨て、時刻の形式の結果を Date にするため、ファイルの XML から直接読む。
 */
function cachedResultsOf(buffer: Buffer, sheetIndex: number): Map<string, number> {
  const xml = readZipEntry(buffer, `xl/worksheets/sheet${sheetIndex + 1}.xml`);
  const results = new Map<string, number>();
  for (const match of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(\/>|>(.*?)<\/c>)/g)) {
    const [, address, , body = ''] = match as unknown as [string, string, string, string | undefined];
    if (!body.includes('<f>')) continue;
    const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
    results.set(address, v === undefined ? Number.NaN : Number(v));
  }
  return results;
}

/**
 * どの式のセルにも結果の値(保護ビュー・プレビューで見える値)があり、書き出した式を計算した値と同じことを確かめる。
 * 結果の値(セルの番地 → 値)を返す。
 */
function expectCachedResults(buffer: Buffer, workbook: ExcelJS.Workbook, sheetIndex: number) {
  const ws = workbook.worksheets[sheetIndex] as ExcelJS.Worksheet;
  const results = cachedResultsOf(buffer, sheetIndex);
  const value = createFormulaEvaluator(ws);
  let formulaCount = 0;
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const raw = cell.value as { formula?: string } | null;
      if (!raw || typeof raw !== 'object' || !('formula' in raw)) return;
      // 結合したセルの左上以外は左上の値を見せるだけ(ファイルには式が無い)
      if (cell.master.address !== cell.address) return;
      formulaCount++;
      const result = results.get(cell.address);
      expect(Number.isFinite(result), `${cell.address} の結果の値`).toBe(true);
      // 空のセルをそのまま返す式(=E4 等)の結果は、Excel では 0
      const evaluated = value(cell.address) ?? 0;
      expect(typeof evaluated, `${cell.address} の式の計算`).toBe('number');
      expect(result as number, `${cell.address} ${raw.formula}`).toBeCloseTo(evaluated as number, 6);
    });
  });
  expect(results.size).toBe(formulaCount);
  return results;
}

describe('出勤簿の Excel の書き出し', () => {
  it('全員分は1人1シートで、シート名は Excel の決まりに直して重ならないようにする', async () => {
    const staff = [
      exportStaffFixture('山田 太郎', '2026-09', SAMPLE_ROWS, SAMPLE_RECEIPTS),
      exportStaffFixture('佐藤/花子', '2026-09', {}),
      exportStaffFixture('山田 太郎', '2026-09', {}),
      exportStaffFixture('とても長い名前のスタッフとても長い名前のスタッフとても長い', '2026-09', {}),
      exportStaffFixture('𠮷'.repeat(20), '2026-09', {}),
    ];
    const buffer = await buildAttendanceWorkbook(allStaffWorkbookSheets(staff));
    const workbook = await load(buffer);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      '山田 太郎',
      '佐藤_花子',
      '山田 太郎 (2)',
      'とても長い名前のスタッフとても長い名前のスタッフとても長い'.slice(0, 31),
      // Excel の31文字は UTF-16 の単位(𠮷 は2つ分)。サロゲートペアの途中では切らない
      `${'𠮷'.repeat(15)}`,
    ]);
    // 開いたときに Excel が全ての式を計算する(exceljs は読むときにこの設定を戻さないので XML を見る)
    expect(readZipEntry(buffer, 'xl/workbook.xml')).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);

    // どのシートにも同じ計算式が入っている(データの無いスタッフも)。式のセルには結果の値もある
    for (const [index, ws] of workbook.worksheets.entries()) {
      expectCachedResults(buffer, workbook, index);
      const layout = sheetLayoutOf(30, ws.name === '山田 太郎' ? SAMPLE_RECEIPTS.length : 0);
      expect(formulaOf(ws, 'F4')).toBe('E4');
      expect(formulaOf(ws, 'G4')).toBe('F4+H4/1440');
      expect(formulaOf(ws, 'J4')).toBe('IF(I4="雪", H4*1.3, H4)');
      expect(formulaOf(ws, 'K33')).toBe('MAX(0,(M33-G33)*1440)');
      expect(formulaOf(ws, 'AD4')).toMatch(/^ROUND\(\(IF\(AND\(COUNT\(D4,E4\)=2, E4>D4\).*\* 1440, 0\)$/);
      expect(formulaOf(ws, 'AD4')).toContain('SEARCH("mtg", X4)');
      expect(formulaOf(ws, 'AE4')).toMatch(/\* 1440, 2\)$/);
      expect(formulaOf(ws, 'AF4')).toBe('J4+S4');
      expect(formulaOf(ws, 'AK4')).toBe('SUM(AG4:AJ4)');
      expect(formulaOf(ws, 'AL4')).toBe(
        'INT(MAX(0, AG4 - 15) / 5) + INT(MAX(0, AH4 - 15) / 5) + INT(MAX(0, AI4 - 15) / 5) + INT(MAX(0, AJ4 - 15) / 5)',
      );
      expect(formulaOf(ws, 'AM4')).toBe(
        'IF(ISNUMBER(AH4), 3, IF(ISNUMBER(AG4), 2, IF(OR(ISNUMBER(AI4), ISNUMBER(AJ4)), 1, 0)))',
      );
      expect(formulaOf(ws, 'AQ4')).toBe(
        `SUMIFS($H$${layout.receiptFirst}:$H$${layout.receiptLast}, $A$${layout.receiptFirst}:$A$${layout.receiptLast}, A4)`,
      );
      expect(formulaOf(ws, `AD${layout.totals}`)).toBe('SUM(AD4:AD33)');
      expect(formulaOf(ws, `AQ${layout.totals}`)).toBe('SUM(AQ4:AQ33)');
      // 距離の入力の列も合計の行に SUM(テンプレートの35行目と同じ)
      for (const col of ['AG', 'AH', 'AI', 'AJ']) {
        expect(formulaOf(ws, `${col}${layout.totals}`)).toBe(`SUM(${col}4:${col}33)`);
      }
      expect(formulaOf(ws, `F${layout.receiptTotal}`)).toBe(
        `SUM($H$${layout.receiptFirst}:$H$${layout.receiptLast})`,
      );
      expect(ws.getCell(`A${layout.totals}`).value).toBe('合計');
      expect(ws.getCell(`A${layout.receiptTotal}`).value).toBe('領収書月集計(円)');
      expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 3 });
      expect(ws.pageSetup).toMatchObject({ orientation: 'landscape', fitToWidth: 1 });
      expect(ws.getCell('C3').value).toBe('#1訪問先等');
      expect(ws.getCell('AO3').value).toBe('備考');
    }
  });

  it('見出し・入力の値(時刻は Excel の時刻の値)・領収書の明細を書く。式に見える文字は文字のまま', async () => {
    const staff = exportStaffFixture('山田 太郎', '2026-09', SAMPLE_ROWS, SAMPLE_RECEIPTS);
    const workbook = await load(await buildAttendanceWorkbook(staffWorkbookSheets(staff)));
    const ws = workbook.worksheets[0] as ExcelJS.Worksheet;
    expect(ws.name).toBe('2026年9月');
    expect([ws.getCell('A2').value, ws.getCell('B2').value]).toEqual([2026, 9]);
    expect(ws.getCell('C2').value).toBe('staff@example.com');
    expect(ws.getCell('H2').value).toBe('山田 太郎');
    expect(ws.getCell('A4').value).toEqual(new Date(Date.UTC(2026, 8, 1)));
    expect(ws.getCell('B4').value).toBe('火');
    expect(ws.getCell('C4').value).toBe('佐藤様');
    const start = ws.getCell('D4');
    expect(start.numFmt).toBe('h:mm');
    // 9:00 = 0.375日(exceljs は時刻の形式のセルを 1899-12-30 起点の Date で返す)
    expect((start.value as Date).getTime() / 86_400_000 + 25_569).toBeCloseTo(0.375, 10);
    expect(ws.getCell('H4').value).toBe(20);
    expect(ws.getCell('I4').value).toBe('雪');
    expect(ws.getCell('AG4').value).toBe(5.55);
    expect(ws.getCell('AO4').value).toBe('雨のため遅延');
    expect(ws.getCell('C5').value).toBeNull();
    // 分の小数の列はテンプレートと同じ表示(整数でも「40.」にならない)。記録の無い日の0は空に見せる
    expect(ws.getCell('J4').numFmt).toBe('#,##0.00;-#,##0.00;');
    expect(ws.getCell(`AE${sheetLayoutOf(30, SAMPLE_RECEIPTS.length).totals}`).numFmt).toBe('#,##0.00');

    const layout = sheetLayoutOf(30, SAMPLE_RECEIPTS.length);
    const first = layout.receiptFirst;
    expect(ws.getCell(`A${layout.receiptHeader}`).value).toBe('日付');
    expect(ws.getCell(`C${first}`).value).toBe('佐藤様');
    expect(ws.getCell(`D${first}`).value).toBe('スーパー');
    expect(ws.getCell(`H${first}`).value).toBe(1200);
    expect(ws.getCell(`I${first}`).value).toBe('牛乳を買いました');
    // 店名に書かれた「=HYPERLINK(…)」は式にしない
    expect(ws.getCell(`D${first + 2}`).value).toBe('=HYPERLINK("https://example.com")');
    expect(ws.getCell(`H${first + 2}`).value).toBeNull();
    expect(ws.getCell(`D${first}`).isMerged).toBe(true);
  });

  it('書き出した式を計算すると、今月のまとめ(アプリの計算)と同じ値になる', async () => {
    const staff = exportStaffFixture('山田 太郎', '2026-09', SAMPLE_ROWS, SAMPLE_RECEIPTS);
    const month = staff.months[0]?.month;
    if (!month) throw new Error('fixture');
    const buffer = await buildAttendanceWorkbook(staffWorkbookSheets(staff));
    const workbook = await load(buffer);
    const ws = workbook.worksheets[0] as ExcelJS.Worksheet;
    const value = createFormulaEvaluator(ws);
    const layout = sheetLayoutOf(month.days.length, SAMPLE_RECEIPTS.length);

    month.days.forEach((day, index) => {
      const row = layout.firstDay + index;
      for (const [col, key] of DAY_CHECKS) {
        expect(value(`${col}${row}`), `${day.businessDate} ${col}`).toBeCloseTo(day.derived[key], 6);
      }
      expect(value(`AQ${row}`), `${day.businessDate} AQ`).toBe(month.receipts.byDay[day.businessDate] ?? 0);
    });
    for (const [col, key] of TOTAL_CHECKS) {
      expect(value(`${col}${layout.totals}`), `合計 ${col}`).toBeCloseTo(month.totals[key], 6);
    }
    expect(value(`AQ${layout.totals}`)).toBe(month.receipts.total);
    expect(value(`F${layout.receiptTotal}`)).toBe(month.receipts.total);
    expect(month.receipts.total).toBe(2450);
    expect(value(`F${layout.receiptCount}`)).toBe(SAMPLE_RECEIPTS.length);
    // 月の集計の欄は合計の行を指す
    expect(value(`F${layout.summaryFirst}`)).toBe(month.totals.workedMinutes);

    // 式のセルには結果の値もあり(保護ビュー・プレビューで空にならない)、式の計算・アプリの計算と同じ
    // (30日 × 計算の列16 + 合計の行17 + 月の集計の欄(時間:分の列を含む)+ 領収書の枚数・月集計)
    const cached = expectCachedResults(buffer, workbook, 0);
    expect(cached.size).toBeGreaterThan(30 * 16 + 17);
    const resultOf = (_ws: ExcelJS.Worksheet, ref: string) => cached.get(ref);
    month.days.forEach((day, index) => {
      const row = layout.firstDay + index;
      for (const [col, key] of DAY_CHECKS) {
        expect(resultOf(ws, `${col}${row}`), `${day.businessDate} ${col}`).toBe(day.derived[key]);
      }
      expect(resultOf(ws, `AQ${row}`)).toBe(month.receipts.byDay[day.businessDate] ?? 0);
    });
    for (const [col, key] of TOTAL_CHECKS) {
      expect(resultOf(ws, `${col}${layout.totals}`), `合計 ${col}`).toBe(month.totals[key]);
    }
    expect(resultOf(ws, `AG${layout.totals}`)).toBe(month.totals.leg1DistanceKmTotal);
    expect(resultOf(ws, `AJ${layout.totals}`)).toBe(month.totals.leavingDistanceKmTotal);
    expect(resultOf(ws, `AQ${layout.totals}`)).toBe(2450);
    expect(resultOf(ws, `F${layout.receiptTotal}`)).toBe(2450);
    expect(resultOf(ws, `F${layout.receiptCount}`)).toBe(SAMPLE_RECEIPTS.length);
    expect(resultOf(ws, `F${layout.summaryFirst}`)).toBe(month.totals.workedMinutes);
  });

  it('乱数で作った多くの日でも、式の計算とアプリの計算が一致する(入力は画面・取込が受け付ける形)', async () => {
    const random = createRandom(20260926);
    const rows: Record<string, AttendanceRowData> = {};
    for (let day = 1; day <= 30; day++)
      rows[`2026-09-${String(day).padStart(2, '0')}`] = randomRowData(random);
    const staff = exportStaffFixture('乱数', '2026-09', rows);
    const month = staff.months[0]?.month;
    if (!month) throw new Error('fixture');
    const buffer = await buildAttendanceWorkbook(staffWorkbookSheets(staff));
    const workbook = await load(buffer);
    const value = createFormulaEvaluator(workbook.worksheets[0] as ExcelJS.Worksheet);
    month.days.forEach((day, index) => {
      const row = 4 + index;
      for (const [col, key] of DAY_CHECKS) {
        expect(
          value(`${col}${row}`),
          `${day.businessDate} ${col} ${JSON.stringify(day.rowData)}`,
        ).toBeCloseTo(computeDayDerived(day.rowData)[key], 6);
      }
      // 移動の列(天候の補正・移動終了)もアプリの値と同じ
      if (day.derived.leg1WeatherAdjustedMoveMin !== '') {
        expect(value(`J${row}`)).toBeCloseTo(day.derived.leg1WeatherAdjustedMoveMin, 6);
      }
      if (day.derived.leg2MoveEnd !== '') {
        expect(Math.round((value(`P${row}`) as number) * 1440) % 1440).toBe(
          Number(day.derived.leg2MoveEnd.slice(0, 2)) * 60 + Number(day.derived.leg2MoveEnd.slice(3)),
        );
      }
    });
    const layout = sheetLayoutOf(30, 0);
    for (const [col, key] of TOTAL_CHECKS) {
      expect(value(`${col}${layout.totals}`), `合計 ${col}`).toBeCloseTo(month.totals[key], 6);
    }
    // 結果の値も、式の計算・アプリの計算と同じ(空のセルを0とする移動・待機の列も)
    const ws = workbook.worksheets[0] as ExcelJS.Worksheet;
    const cached = expectCachedResults(buffer, workbook, 0);
    const resultOf = (_ws: ExcelJS.Worksheet, ref: string) => cached.get(ref);
    month.days.forEach((day, index) => {
      const row = 4 + index;
      for (const [col, key] of DAY_CHECKS) {
        expect(resultOf(ws, `${col}${row}`)).toBe(day.derived[key]);
      }
      if (day.derived.leg1WaitMin !== '') expect(resultOf(ws, `K${row}`)).toBe(day.derived.leg1WaitMin);
      if (day.derived.leg2WaitMin !== '') expect(resultOf(ws, `T${row}`)).toBe(day.derived.leg2WaitMin);
    });
    for (const [col, key] of TOTAL_CHECKS) {
      expect(resultOf(ws, `${col}${layout.totals}`)).toBe(month.totals[key]);
    }
    for (const [col, key] of [
      ['AG', 'leg1DistanceKmTotal'],
      ['AH', 'leg2DistanceKmTotal'],
      ['AI', 'attendanceDistanceKmTotal'],
      ['AJ', 'leavingDistanceKmTotal'],
    ] as const) {
      expect(resultOf(ws, `${col}${layout.totals}`), `合計 ${col}`).toBe(month.totals[key]);
      expect(value(`${col}${layout.totals}`), `合計 ${col}`).toBeCloseTo(month.totals[key], 6);
    }
  });

  it('年度の書き出しは4月〜3月の12シート', async () => {
    const staff = exportStaffFixture('山田 太郎', '2026-04', {});
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].concat([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    const fiscal = {
      ...staff,
      months: months.flatMap((m) => exportStaffFixture('山田 太郎', m, {}).months),
    };
    const workbook = await load(await buildAttendanceWorkbook(staffWorkbookSheets(fiscal)));
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
      '1月',
      '2月',
      '3月',
    ]);
    // 2月(28日)は合計の行が 4+28 行目
    const feb = workbook.getWorksheet('2月') as ExcelJS.Worksheet;
    expect(formulaOf(feb, 'AD32')).toBe('SUM(AD4:AD31)');
  });
});

/** .xlsx(zip)の中の1ファイルを読む(中央ディレクトリから探す)。 */
function readZipEntry(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    if (zip.toString('utf8', offset + 46, offset + 46 + nameLength) === name) {
      const start =
        localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} がありません`);
}

// ── 乱数の入力(gasParity.test.ts と同じ乱数。値は保存の検証を通る形だけ) ──

function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  const chance = (p: number): boolean => next() < p;
  return { int, pick, chance };
}

function randomRowData(r: ReturnType<typeof createRandom>): AttendanceRowData {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const row: AttendanceRowData = {};
  for (const column of ATTENDANCE_COLUMN_KEYS) {
    if (r.chance(0.35)) continue;
    if (['D', 'E', 'M', 'N', 'V', 'W', 'Y', 'Z', 'AB', 'AC'].includes(column))
      row[column] = hhmm(r.int(28, 88) * 15);
    else if (['H', 'Q'].includes(column)) row[column] = r.pick(['0', '5', '13', '15', '20', '31']);
    else if (['AG', 'AH', 'AI', 'AJ'].includes(column))
      row[column] = r.pick(['0', '5', '12.5', '15', '16', '20.25', '31']);
    else if (column === 'AN') row[column] = r.pick(['0', '1', '2']);
    else if (column === 'I' || column === 'R') row[column] = r.pick(['晴れ', '雨', '雪', '曇り']);
    else if (column === 'X' || column === 'AA')
      row[column] = r.pick(['チームmtg', '広報業務', 'MTG', '事務']);
    else row[column] = r.pick(['佐藤様', '鈴木様', '田中様']);
  }
  return row;
}
