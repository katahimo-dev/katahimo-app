import { parseStaffSheet, staffToSheet, UNREADABLE_CELL } from '@katahimo/core/domain';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildStaffWorkbook, readStaffWorkbook } from './staffWorkbook';
import { inspectZip } from './xlsxZipGuard';

const STAFF_ID = '0190a000-0000-7000-8000-000000000002';

/** 重ならない漢字の文字(圧縮の効きにくい、いちばん大きくなる中身)。 */
const kanji = (length: number, seed: number) =>
  Array.from({ length }, (_, i) => String.fromCharCode(0x4e00 + ((seed * 7919 + i * 104729) % 20000))).join(
    '',
  );

describe('スタッフの xlsx', () => {
  it('書き出した xlsx を読むと同じ値に戻り、電話・退職日の列は文字の書式', async () => {
    const sheet = staffToSheet([
      {
        id: STAFF_ID,
        name: '佐藤 花子',
        kana: 'サトウ ハナコ',
        email: 'hanako@example.com',
        altEmail: null,
        phone: '090-1111-2222',
        role: 'coordinator',
        retiredOn: '2026-10-31',
        homeAddress: '東京都世田谷区',
        travelMode: 'walk',
        gender: 'unknown',
        scheduleCalendarId: null,
      },
    ]);
    const body = await buildStaffWorkbook(sheet);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
    const ws = workbook.getWorksheet('スタッフ') as ExcelJS.Worksheet;
    expect(ws.getCell('F2').numFmt).toBe('@');
    expect(ws.getCell('H2').numFmt).toBe('@');
    const parsed = parseStaffSheet(await readStaffWorkbook(body));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        row: 2,
        id: STAFF_ID,
        values: {
          name: '佐藤 花子',
          kana: 'サトウ ハナコ',
          email: 'hanako@example.com',
          altEmail: null,
          phone: '090-1111-2222',
          role: 'coordinator',
          retiredOn: '2026-10-31',
          homeAddress: '東京都世田谷区',
          travelMode: 'walk',
          gender: 'unknown',
          scheduleCalendarId: null,
        },
      },
    ]);
  });

  it('Excel で入れた日付のセルも退職日として読む。xlsx でないファイルは 400', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('一覧');
    ws.addRow(['氏名', 'メールアドレス', '退職日']);
    ws.addRow(['A', 'a@example.com', new Date(Date.UTC(2026, 8, 30))]);
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(parseStaffSheet(await readStaffWorkbook(body)).rows[0]?.values.retiredOn).toBe('2026-09-30');
    await expect(readStaffWorkbook(Buffer.from('not a zip'))).rejects.toMatchObject({
      reason: 'invalid_xlsx',
    });
  });

  it('リンク・書式つきの文字は文字として読み、エラーの値・計算結果の無い式は読めないセル(空欄にしない)として行の誤りにする', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('スタッフ');
    ws.addRow(['氏名', 'メールアドレス', '電話', '自宅住所', '予定カレンダーID']);
    ws.addRow(['A', 'a@example.com', null, null, null]);
    // 書式つきの文字のリンク(exceljs の型は text を文字としているが、読んだファイルでは書式つきの文字のこともある)
    ws.getCell('B2').value = {
      text: { richText: [{ text: 'a@' }, { font: { bold: true }, text: 'example.com' }] },
      hyperlink: 'mailto:a@example.com',
    } as unknown as ExcelJS.CellHyperlinkValue;
    ws.getCell('C2').value = { formula: '"090"&"-1111"', result: '090-1111' };
    ws.getCell('D2').value = { richText: [{ text: '東京都' }, { font: { bold: true }, text: '世田谷区' }] };
    ws.getCell('E2').value = { text: 'a@cutest.biz', hyperlink: 'mailto:a@cutest.biz' };
    ws.addRow(['B', 'b@example.com', null, null, null]);
    ws.getCell('C3').value = { error: '#N/A' } as ExcelJS.CellErrorValue;
    ws.getCell('D3').value = { formula: 'X1&Y1' } as ExcelJS.CellFormulaValue;
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    const sheets = await readStaffWorkbook(body);
    expect(sheets[0]?.rows[1]).toEqual(['A', 'a@example.com', '090-1111', '東京都世田谷区', 'a@cutest.biz']);
    expect(sheets[0]?.rows[2]?.slice(2, 4)).toEqual([UNREADABLE_CELL, UNREADABLE_CELL]);
    const parsed = parseStaffSheet(sheets);
    expect(parsed.rows.map((r) => r.row)).toEqual([2]);
    expect(parsed.errors).toEqual([
      { row: 3, message: expect.stringContaining('「電話」の列のセルを読めません') },
      { row: 3, message: expect.stringContaining('「自宅住所」の列のセルを読めません') },
    ]);
  });

  it('シートの行の上限(見出しを含めて2000行)まで全ての列を上限の長さにして書き出したファイルも、展開の上限の内で読める', async () => {
    const staff = Array.from({ length: 1999 }, (_, i) => ({
      id: `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
      name: kanji(100, i),
      kana: kanji(100, i + 1),
      email: `${'a'.repeat(60)}${i}@${'b'.repeat(60)}.example.com`,
      altEmail: `${'c'.repeat(60)}${i}@example.com`,
      phone: `090-${String(i).padStart(4, '0')}-${'1'.repeat(20)}`,
      role: 'staff' as const,
      retiredOn: '2026-10-31',
      homeAddress: kanji(300, i + 2),
      travelMode: 'car' as const,
      gender: 'female' as const,
      scheduleCalendarId: `${'d'.repeat(100)}${i}@group.calendar.google.com`,
    }));
    const sheet = staffToSheet(staff);
    const body = await buildStaffWorkbook(sheet);
    // 取込のファイルの上限(2MB)の内で、展開しても上限(合計8MB・1つ5MB)に余裕がある(測った値は約1.5MB → 4.5MB)
    expect(body.length).toBeLessThan(2 * 1024 * 1024);
    const inspected = inspectZip(body);
    expect(inspected).toMatchObject({ ok: true });
    expect(inspected.ok && inspected.totalBytes).toBeLessThan(6 * 1024 * 1024);
    const [read] = await readStaffWorkbook(body);
    expect(read?.rows).toHaveLength(2000);
    expect(read?.rows[1999]).toEqual(sheet.rows[1998]);
  }, 60_000);
});
