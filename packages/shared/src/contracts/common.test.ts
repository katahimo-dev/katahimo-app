import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { attendanceRowDataSchema } from './attendance';
import { freeText, recordDateSchema, stripControlChars } from './common';
import { receiptTimestampSchema, uploadReceiptsRequestSchema } from './receipts';
import { saveDailyReportRequestSchema } from './reports';

describe('自由記述の制御文字', () => {
  it('タブ・改行・復帰は残し、U+0000 などの C0 制御文字だけを取り除く', () => {
    expect(stripControlChars('a\u0000b\u0001c\u0008\u000b\u000c\u000e\u001fd')).toBe('abcd');
    expect(stripControlChars('1行目\r\n\t2行目')).toBe('1行目\r\n\t2行目');
  });

  it('freeText は null・省略をそのまま通す', () => {
    const schema = freeText(z.string().nullable().optional());
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse('x\u0000y')).toBe('xy');
  });

  it('日報・出勤簿のセルの入力から取り除く', () => {
    const report = saveDailyReportRequestSchema.parse({
      customerId: '01890a5d-ac96-774b-bcce-b302099a8057',
      inputText: 'メモ\u0000です\n改行',
    });
    expect(report.inputText).toBe('メモです\n改行');
    expect(report.internalText).toBe('');
    expect(attendanceRowDataSchema.parse({ C: '09:00\u0000' }).C).toBe('09:00');
  });
});

describe('記録の日付(日報の訪問日・領収書の日時)', () => {
  it('実在する 2000〜2100年の日付だけを書き込める', () => {
    for (const ok of ['2000-01-01', '2100-12-31', '2028-02-29']) {
      expect(recordDateSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['1999-12-31', '2101-01-01', '0001-01-01', '2026-02-30', '2026-13-01', '2026-00-10']) {
      expect(recordDateSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(receiptTimestampSchema.safeParse('2026/09/05 09:05').success).toBe(true);
    expect(receiptTimestampSchema.safeParse('1990/09/05 09:05').success).toBe(false);
    expect(receiptTimestampSchema.safeParse('2026/02/30 09:05').success).toBe(false);
    const upload = (extra: Record<string, unknown>) =>
      uploadReceiptsRequestSchema.safeParse({ images: [{ data: 'data:image/jpeg;base64,AAAA' }], ...extra });
    expect(upload({ reportDate: '2026-09-05' }).success).toBe(true);
    expect(upload({ reportDate: '2201-09-05' }).success).toBe(false);
  });
});
