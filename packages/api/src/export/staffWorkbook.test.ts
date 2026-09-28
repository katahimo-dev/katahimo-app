import { parseStaffSheet, staffToSheet } from '@katahimo/core/domain';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildStaffWorkbook, readStaffWorkbook } from './staffWorkbook';

const STAFF_ID = '0190a000-0000-7000-8000-000000000002';

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
});
