import { describe, expect, it } from 'vitest';
import { computeDayDerived } from './attendanceCalc';
import { ATTENDANCE_COLUMN_KEYS, ATTENDANCE_COLUMNS } from './sheetLayout';
import {
  ATTENDANCE_SHEET_COLUMNS,
  excelTimeValue,
  fiscalYearMonths,
  sanitizeSheetName,
  sheetColumnOf,
  sheetInputValue,
  uniqueSheetNames,
} from './sheetTemplate';

describe('書き出す出勤簿の列', () => {
  it('A〜AQ の順に並び、入力の列は出勤簿の入力の列(rowData のキー)と同じ列記号', () => {
    const letters = ATTENDANCE_SHEET_COLUMNS.map((c) => c.letter);
    expect(letters[0]).toBe('A');
    expect(letters.at(-1)).toBe('AQ');
    expect(new Set(letters).size).toBe(letters.length);
    const inputs = ATTENDANCE_SHEET_COLUMNS.filter((c) => c.input);
    expect(inputs.map((c) => c.input).sort()).toEqual([...ATTENDANCE_COLUMN_KEYS].sort());
    for (const c of inputs) expect(c.letter).toBe(c.input);
    // 入力の列に式は無く、計算の列には必ず式がある
    for (const c of ATTENDANCE_SHEET_COLUMNS) expect(Boolean(c.formula)).toBe(c.role === 'formula');
    // 計算の列には式の結果の値、合計の行に SUM を置く列には合計の値がある(保護ビュー・プレビューで空にしない)
    for (const c of ATTENDANCE_SHEET_COLUMNS) {
      expect(Boolean(c.cachedResult), c.letter).toBe(Boolean(c.formula));
      expect(Boolean(c.cachedTotal), c.letter).toBe(Boolean(c.sumInTotals));
    }
  });

  it('合計の行に SUM を置く列はテンプレートの35行目と同じ(距離の入力の列 AG〜AJ を含む)+ AP・AQ', () => {
    expect(ATTENDANCE_SHEET_COLUMNS.filter((c) => c.sumInTotals).map((c) => c.letter)).toEqual([
      'AD',
      'AE',
      'AF',
      'AG',
      'AH',
      'AI',
      'AJ',
      'AK',
      'AL',
      'AM',
      'AN',
      'AP',
      'AQ',
    ]);
  });

  it('式の結果の値: 空のセルは0(Excel の式と同じ)、移動・待機はその日の入力から、集計はアプリの計算の値', () => {
    const derived = computeDayDerived({ E: '10:00', H: '20', I: '雪', M: '11:00', AG: '16' });
    const day = {
      rowData: { E: '10:00', H: '20', I: '雪', M: '11:00', AG: '16' },
      derived,
      receiptYen: 1200,
    };
    const result = (letter: string) => sheetColumnOf(letter).cachedResult?.(day);
    expect(result('F')).toBe(600 / 1440);
    expect(result('G')).toBe(620 / 1440);
    expect(result('J')).toBe(26);
    expect(result('K')).toBe(40);
    // #2 の移動は入力が無いので0(Excel の =N4 等も空のセルは0)
    expect([result('O'), result('P'), result('S'), result('T')]).toEqual([0, 0, 0, 0]);
    expect(result('AL')).toBe(derived.overThresholdCount);
    expect(result('AM')).toBe(2);
    expect(result('AQ')).toBe(1200);
    // 終業と次の始業だけ(計画移動時間なし)でも Excel と同じく待機時間を出す
    const noPlan = { rowData: { E: '10:00', M: '10:30' }, derived: computeDayDerived({}), receiptYen: 0 };
    expect(sheetColumnOf('K').cachedResult?.(noPlan)).toBe(30);
  });

  it('時刻の入力の列は時刻、距離は km、それ以外の数の列は数', () => {
    for (const key of ATTENDANCE_COLUMN_KEYS) {
      const column = sheetColumnOf(key);
      if (ATTENDANCE_COLUMNS[key].kind === 'time') expect(column.kind).toBe('time');
    }
    expect(['AG', 'AH', 'AI', 'AJ'].map((l) => sheetColumnOf(l).kind)).toEqual(['km', 'km', 'km', 'km']);
    expect(sheetColumnOf('H').kind).toBe('number');
    expect(sheetColumnOf('AN').kind).toBe('number');
  });

  it('入力の値: 時刻は1日を1とした値、数は数、空は null、形の合わない値は文字のまま', () => {
    expect(excelTimeValue('09:00')).toBe(0.375);
    expect(sheetInputValue(sheetColumnOf('D'), { D: '17:30' })).toBe(17.5 / 24);
    expect(sheetInputValue(sheetColumnOf('D'), { D: '9時' })).toBe('9時');
    expect(sheetInputValue(sheetColumnOf('AG'), { AG: '5.50' })).toBe(5.5);
    expect(sheetInputValue(sheetColumnOf('H'), { H: 'abc' })).toBe('abc');
    expect(sheetInputValue(sheetColumnOf('C'), { C: ' 佐藤様 ' })).toBe('佐藤様');
    expect(sheetInputValue(sheetColumnOf('C'), {})).toBeNull();
    expect(sheetInputValue(sheetColumnOf('F'), { C: 'x' })).toBeNull();
  });
});

describe('シート名', () => {
  it('使えない文字を _ にし、31文字までにする。空・History は代わりの名前', () => {
    expect(sanitizeSheetName('佐藤/花子[1]:*?')).toBe('佐藤_花子_1____');
    expect(sanitizeSheetName("'山田'")).toBe('山田');
    expect(sanitizeSheetName('   ')).toBe('シート');
    expect(sanitizeSheetName('history')).toBe('シート');
    expect([...sanitizeSheetName('あ'.repeat(40))]).toHaveLength(31);
  });

  it('31文字は UTF-16 の単位で数え(𠮷 は2つ分)、サロゲートペアの途中では切らない', () => {
    const name = sanitizeSheetName('𠮷'.repeat(20));
    expect(name).toBe('𠮷'.repeat(15));
    expect(name.length).toBe(30);
    expect(sanitizeSheetName(`あ${'𠮷'.repeat(20)}`)).toBe(`あ${'𠮷'.repeat(15)}`);
    expect(sanitizeSheetName(`あ${'𠮷'.repeat(20)}`).length).toBe(31);
    const unique = uniqueSheetNames(['𠮷'.repeat(20), '𠮷'.repeat(20)]);
    expect(unique[1]).toBe(`${'𠮷'.repeat(13)} (2)`);
    expect((unique[1] as string).length).toBeLessThanOrEqual(31);
    // 切った後に孤立したサロゲートが残らない
    for (const n of unique) expect(n).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('同じ名前(大文字小文字の違いを含む)は (2)・(3) を付ける', () => {
    expect(uniqueSheetNames(['山田', '山田', 'abc', 'ABC', '山田'])).toEqual([
      '山田',
      '山田 (2)',
      'abc',
      'ABC (2)',
      '山田 (3)',
    ]);
    const long = 'い'.repeat(31);
    const names = uniqueSheetNames([long, long]);
    expect([...(names[1] as string)]).toHaveLength(31);
    expect(names[1]?.endsWith(' (2)')).toBe(true);
  });
});

describe('年度の月', () => {
  it('4月から翌年の3月まで', () => {
    expect(fiscalYearMonths(2026)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
  });
});
