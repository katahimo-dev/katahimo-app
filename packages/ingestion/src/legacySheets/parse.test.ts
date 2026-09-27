import { describe, expect, it } from 'vitest';
import { parseReceiptSheet } from './receiptSheet';
import { parseAccidentReportSheet, parseDailyReportSheet } from './reportSheets';
import {
  ACCIDENT_HEADER,
  DAILY_HEADER,
  driveLink,
  RECEIPT_HEADER,
  serial,
  testSheet,
  timeCell,
} from './testSheets';

const FILE_A = '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FILE_B = '1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('parseDailyReportSheet(GAS版の「日報」シート)', () => {
  it('列の位置から読み、日時・時刻はシリアル値でも文字列でも同じ形に揃え、ID の数値は数字の文字列にする', () => {
    const parsed = parseDailyReportSheet(
      testSheet('日報', [
        DAILY_HEADER,
        [
          serial('2026/09/05 09:00:00'),
          timeCell('09:00'),
          timeCell('12:30'),
          '山田 太郎',
          1001,
          '佐藤様',
          'メモ',
          '社内\n2行目',
          'ご家庭向け',
          3,
          5,
        ],
        ['2026/9/6 9:00', '9:00', '12:00', ' 山田　太郎 ', '1001', '佐藤様', '', '', '', '', ''],
      ]),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({
      source: 'gas_daily_report',
      rowNumber: 2,
      timestamp: '2026/09/05 09:00:00',
      staffName: '山田 太郎',
      customerExternalId: '1001',
      sourceKey: JSON.stringify(['2026/09/05 09:00:00', '山田太郎', '1001', '09:00']),
      content: {
        startTime: '09:00',
        endTime: '12:30',
        inputText: 'メモ',
        internalText: '社内\n2行目',
        customerText: 'ご家庭向け',
      },
      riskRating: 3,
      esRating: 5,
    });
    // 空白の入り方が違っても同じスタッフのキー(全角空白も除く)
    expect(parsed.rows[1]?.sourceKey).toBe(
      JSON.stringify(['2026/09/06 09:00:00', '山田太郎', '1001', '09:00']),
    );
    expect(parsed.rows[1]).toMatchObject({ riskRating: null, esRating: null });
  });

  it('本アプリからのミラーの行・日時の読めない行は除き、空の行は数えるだけ。読めない評価・時刻は空にして注意にする', () => {
    const parsed = parseDailyReportSheet(
      testSheet('日報', [
        DAILY_HEADER,
        [
          serial('2026/09/05 09:00:00'),
          '09:00',
          '12:00',
          '山田 太郎',
          1,
          '',
          '',
          '',
          '',
          '',
          '',
          '0199a0b0-0000-7000-8000-000000000001',
        ],
        ['いつか', '09:00', '', '山田 太郎', 1, '', '', '', '', '', ''],
        [null, null, '', null],
        [serial('2026/09/07 10:00:00'), '午前', '12:00', '山田 太郎', 1, '', '', '', '', 'とても良い', 6],
      ]),
    );
    expect(parsed.issues).toEqual([
      { source: 'gas_daily_report', rowNumber: 2, reason: 'from_app' },
      { source: 'gas_daily_report', rowNumber: 3, reason: 'invalid_timestamp' },
      { source: 'gas_daily_report', rowNumber: 5, reason: 'time_invalid' },
      { source: 'gas_daily_report', rowNumber: 5, reason: 'rating_invalid' },
      { source: 'gas_daily_report', rowNumber: 5, reason: 'rating_invalid' },
    ]);
    expect(parsed.blankRowCount).toBe(1);
    expect(parsed.rows.map((r) => [r.rowNumber, r.content.startTime, r.riskRating, r.esRating])).toEqual([
      [5, '', null, null],
    ]);
  });

  it('同じキーの2行目以降は #2・#3 を付ける(同じ訪問の日報を2回新しく保存した)', () => {
    const row = [serial('2026/09/05 09:00:00'), '09:00', '12:00', '山田 太郎', 1, '', '1回目'];
    const parsed = parseDailyReportSheet(
      testSheet('日報', [DAILY_HEADER, row, [...row.slice(0, 6), '2回目'], [...row.slice(0, 6), '3回目']]),
    );
    const base = JSON.stringify(['2026/09/05 09:00:00', '山田太郎', '1', '09:00']);
    expect(parsed.rows.map((r) => r.sourceKey)).toEqual([base, `${base}#2`, `${base}#3`]);
  });

  it('見出しが GAS版の日報でないシートは読まない。空のシートは0行', () => {
    expect(() => parseDailyReportSheet(testSheet('Sheet1', [['日時', '名前']]))).toThrow('日報');
    expect(parseDailyReportSheet(testSheet('日報', []))).toEqual({ rows: [], issues: [], blankRowCount: 0 });
  });
});

describe('parseAccidentReportSheet(GAS版の「事故報告」シート)', () => {
  it('見出しに TargetName が無くても行は16列の位置で読み、ReportType で事故報告とヒヤリハットを分ける', () => {
    const parsed = parseAccidentReportSheet(
      testSheet('事故報告', [
        ACCIDENT_HEADER,
        [
          serial('2026/09/05 15:10:20'),
          '山田 太郎',
          1001,
          '佐藤様',
          '佐藤 花子',
          { value: 40179, text: '2010/01/01' },
          '2026/09/05 14:00',
          '居間',
          '転倒',
          '走っていて',
          '冷やした',
          '電話で説明',
          'なし',
          '見守る',
          'メモ',
          'ヒヤリハット',
        ],
        [serial('2026/09/06 10:00:00'), '山田 太郎', 1001],
      ]),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      reportType: 'ヒヤリハット',
      sourceKey: JSON.stringify(['2026/09/05 15:10:20', '山田太郎', '1001']),
      content: {
        targetName: '佐藤 花子',
        targetDob: '2010/01/01',
        occurrenceTime: '2026/09/05 14:00',
        location: '居間',
        accidentContent: '転倒',
        situation: '走っていて',
        immediateResponse: '冷やした',
        parentCorrespondence: '電話で説明',
        diagnosisTreatment: 'なし',
        prevention: '見守る',
        inputText: 'メモ',
      },
    });
    expect(parsed.rows[1]).toMatchObject({ reportType: '', content: { targetName: '', inputText: '' } });
  });

  it('KatahimoReportId(17列目)のある行は本アプリからのミラーとして除く', () => {
    const row = [serial('2026/09/05 15:10:20'), '山田 太郎', 1001];
    const mirrored = [...row, ...Array(13).fill(''), 'reportId'];
    const parsed = parseAccidentReportSheet(testSheet('事故報告', [ACCIDENT_HEADER, mirrored]));
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toEqual([{ source: 'gas_accident_report', rowNumber: 2, reason: 'from_app' }]);
  });
});

describe('parseReceiptSheet(GAS版の「領収書一覧」)', () => {
  it('画像の Drive のファイル ID を行のキーにし、金額の数値は数字の文字列にする', () => {
    const parsed = parseReceiptSheet(
      testSheet('シート1', [
        RECEIPT_HEADER,
        [
          serial('2026/09/05 12:30:00'),
          '山田 太郎',
          1001,
          '佐藤様',
          { value: 1200, text: '¥1,200' },
          'コンビニ',
          driveLink(FILE_A),
          '申し送り\nです',
        ],
        ['2026/09/05 12:30', '山田 太郎', '', '', '', '', driveLink(FILE_B), ''],
      ]),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        source: 'gas_receipt',
        rowNumber: 2,
        sourceKey: FILE_A,
        timestamp: '2026/09/05 12:30:00',
        staffName: '山田 太郎',
        customerExternalId: '1001',
        customerName: '佐藤様',
        amount: '1200',
        storeName: 'コンビニ',
        handoffText: '申し送り\nです',
      },
      expect.objectContaining({ rowNumber: 3, sourceKey: FILE_B, customerExternalId: '', amount: '' }),
    ]);
  });

  it('本アプリからのミラーの行・日時の読めない行・写真の URL の無い行・同じ画像の2行目は除く', () => {
    const base = [serial('2026/09/05 12:30:00'), '山田 太郎', 1001, '佐藤様', 500, '駐車場'];
    const parsed = parseReceiptSheet(
      testSheet('シート1', [
        RECEIPT_HEADER,
        [...base, driveLink(FILE_A), '', 'receiptId'],
        ['不明', ...base.slice(1), driveLink(FILE_A)],
        [...base, '(画像なし)'],
        [...base, driveLink(FILE_B)],
        [...base, driveLink(FILE_B)],
        [],
      ]),
    );
    expect(parsed.issues.map((i) => [i.rowNumber, i.reason])).toEqual([
      [2, 'from_app'],
      [3, 'invalid_timestamp'],
      [4, 'image_link_missing'],
      [6, 'duplicate'],
    ]);
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([5]);
    expect(parsed.blankRowCount).toBe(1);
  });

  it('見出しが GAS版の領収書一覧でないシートは読まない', () => {
    expect(() => parseReceiptSheet(testSheet('シート1', [['Timestamp']]))).toThrow('領収書一覧');
  });
});
