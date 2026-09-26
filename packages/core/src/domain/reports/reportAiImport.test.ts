import { describe, expect, it } from 'vitest';
import { syntheticMasterSheets, syntheticPasteBlockSheet } from '../../testSupport/reportAiFixtures';
import {
  cellText,
  detectSheet,
  normalizeHeader,
  parseCodeList,
  parseCountRange,
  parseLevelRange,
  parseMonthRange,
  parsePhraseKind,
  parsePsiRange,
  parseReportAiWorkbook,
  parseTermNamePolicy,
  type ReportAiImportSheet,
  reportAiMastersToSheets,
} from './reportAiImport';

describe('値の書き方のゆれ', () => {
  it('見出しは全角/半角・括弧の中・記号の違いを吸収する', () => {
    expect(normalizeHeader('PSI下限(この値以上で使用可)')).toBe(normalizeHeader('ＰＳＩ下限'));
    expect(normalizeHeader('✕避ける（上から目線・評価）')).toBe('避ける');
    expect(normalizeHeader('対象年齢\n(月齢)')).toBe(normalizeHeader('対象年齢(表示)'));
  });

  it('★の範囲・PSIの範囲・教育語の数・月齢・ID の並び・区分・用語名の扱い', () => {
    expect(parseLevelRange('4-5')).toEqual([4, 5]);
    expect(parseLevelRange('★3〜★5')).toEqual([3, 5]);
    expect(parseLevelRange('5')).toEqual([5, 5]);
    expect(parseLevelRange('３以上')).toEqual([3, 5]);
    // Excel が「4-5」を日付(4月5日)にしてしまった場合
    expect(parseLevelRange(new Date(Date.UTC(2026, 3, 5)))).toEqual([4, 5]);
    expect(parseLevelRange('高め')).toBeNull();
    expect(parsePsiRange('1〜4')).toEqual([1, 4]);
    expect(parsePsiRange('全PSI可')).toEqual([1, 5]);
    expect(parsePsiRange('全日報で不使用（PSI問わず）')).toEqual([1, 5]);
    expect(parseCountRange('0個')).toEqual([0, 0]);
    expect(parseCountRange('0〜1個')).toEqual([0, 1]);
    expect(parseCountRange('1〜2個（詰め込みNG）')).toEqual([1, 2]);
    expect(parseMonthRange('0〜6ヶ月')).toEqual([0, 6]);
    expect(parseMonthRange('12〜24ヶ月')).toEqual([12, 24]);
    expect(parseMonthRange('3-6歳(36-84)')).toEqual([36, 84]);
    expect(parseMonthRange('1〜2歳')).toEqual([12, 36]);
    expect(parseMonthRange('1歳')).toEqual([12, 24]);
    expect(parseMonthRange('全年齢')).toEqual([0, 144]);
    expect(parseCodeList('K11 K12　K24、K06')).toEqual(['K11', 'K12', 'K24', 'K06']);
    expect(parsePhraseKind('◎使う')).toBe('warm');
    expect(parsePhraseKind('✕避ける')).toBe('avoid');
    expect(parsePhraseKind('その他')).toBeNull();
    expect(parseTermNamePolicy('用語名NG')).toBe('forbid');
    expect(parseTermNamePolicy('用語名は出さない')).toBe('forbid');
    expect(parseTermNamePolicy('概念は説明、用語名は控えめ')).toBe('sparing');
    expect(parseTermNamePolicy('用語名OK・必ず説明とセット')).toBe('allow');
    expect(parseTermNamePolicy('用語名を積極活用（説明必須）')).toBe('allow');
    expect(cellText(36)).toBe('36');
  });
});

describe('マスターの xlsx の読み取り', () => {
  it('シートの種類は見出しの行で決め、1行目の注記・使い方・フロー図のシートは読み飛ばす', () => {
    const sheets = syntheticMasterSheets();
    expect(sheets.map((s) => detectSheet(s)?.spec.kind ?? null)).toEqual([
      null,
      'keywords',
      'ageBands',
      'educationLevels',
      'psiLevels',
      'phrases',
      'stanceRules',
      null,
    ]);
    expect(detectSheet(sheets[4] as ReportAiImportSheet)?.headerRow).toBe(1);
  });

  it('全ての表を誤り無く読む', () => {
    const parsed = parseReportAiWorkbook(syntheticMasterSheets());
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.map((w) => w.sheet)).toEqual(['00_使い方', '07_参照フロー図']);
    expect(parsed.rowCounts).toEqual({
      keywords: 3,
      ageBands: 3,
      educationLevels: 5,
      psiLevels: 5,
      phrases: 3,
      stanceRules: 2,
    });
    expect(parsed.keywords[0]).toEqual({
      code: 'K01',
      category: '分類A',
      keyword: '語A',
      subConcept: '概念A',
      ageLabel: '3〜6歳',
      ageFromMonths: 36,
      ageToMonths: 84,
      ageBandLabel: '3・4・5・6歳',
      educationLevelMin: 4,
      educationLevelMax: 5,
      psiMin: 3,
      tone: '意味づけ',
      parentExplanation: '説明A',
      phraseExamples: '① 例A1\n② 例A2',
      usageScene: '場面A',
      ngExample: 'NG A',
      sortOrder: 0,
    });
    expect(parsed.keywords[2]).toMatchObject({ educationLevelMin: 5, educationLevelMax: 5, psiMin: 4 });
    expect(parsed.ageBands[1]).toMatchObject({
      label: '6-12ヶ月',
      ageFromMonths: 6,
      ageToMonths: 12,
      keywordCodes: ['K03'],
    });
    expect(
      parsed.educationLevels.map((l) => [l.level, l.keywordsMin, l.keywordsMax, l.termNamePolicy]),
    ).toEqual([
      [1, 0, 0, 'forbid'],
      [2, 0, 1, 'forbid'],
      [3, 1, 1, 'sparing'],
      [4, 1, 2, 'allow'],
      [5, 1, 2, 'allow'],
    ]);
    expect(parsed.psiLevels[0]).toEqual({ level: 5, label: '定義5', criteria: '基準5' });
    expect(parsed.phrases.map((p) => [p.kind, p.psiMin, p.psiMax])).toEqual([
      ['warm', 1, 4],
      ['warm', 1, 5],
      ['avoid', 1, 5],
    ]);
    expect(parsed.stanceRules[1]).toMatchObject({
      topic: '締め',
      avoidText: '避ける2',
      recommendedText: '推奨2',
    });
  });

  it('プロンプト変更案の貼付用の表(対象年齢の括弧の中の月齢)もキーワードとして読み、後のシートの行を使う', () => {
    const parsed = parseReportAiWorkbook([...syntheticMasterSheets(), syntheticPasteBlockSheet()]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.keywords.map((k) => k.code)).toEqual(['K01', 'K02', 'K03', 'K09']);
    expect(parsed.keywords[0]).toMatchObject({
      ageLabel: '3-6歳',
      parentExplanation: '説明A2',
      phraseExamples: '短い例A',
    });
    expect(parsed.keywords[3]).toMatchObject({
      ageFromMonths: 0,
      ageToMonths: 96,
      educationLevelMin: 5,
      psiMin: 4,
    });
    expect(parsed.warnings.some((w) => w.message.includes('「K01」はシート「01_マスター表」にもある'))).toBe(
      true,
    );
  });

  it('読めない値・契約に合わない値・同じシートの同じキーは、シート名と行番号つきの誤りにする', () => {
    const extra: Record<string, ReportAiImportSheet['rows']> = {
      '01_マスター表': [
        ['K04', null, '語E', null, null, null, null, null, '高め', 3],
        ['K05', null, '語F', null, null, 50, 20, null, '3', 3],
        ['K01', null, '語G', null, null, 0, 10, null, '3', 3],
        ['あ', null, '語H', null, null, 0, 10, null, '3', 3],
      ],
      '05_温かみ表現_PSI配慮': [['その他', '表現X', null, null, null]],
    };
    const sheets = syntheticMasterSheets().map((s) => ({
      ...s,
      rows: [...s.rows, ...(extra[s.name] ?? [])],
    }));
    const parsed = parseReportAiWorkbook(sheets);
    expect(parsed.errors).toEqual([
      { sheet: '01_マスター表', row: 5, message: expect.stringContaining('教育思考レベル適用★「高め」') },
      { sheet: '01_マスター表', row: 6, message: expect.stringContaining('年齢の下限は上限以下') },
      { sheet: '01_マスター表', row: 7, message: '同じキー「K01」の行が2つあります' },
      { sheet: '01_マスター表', row: 8, message: expect.stringContaining('半角英数字') },
      { sheet: '05_温かみ表現_PSI配慮', row: 6, message: expect.stringContaining('区分「その他」') },
    ]);
  });

  it('書き出した表はそのまま同じ中身として読める', () => {
    const parsed = parseReportAiWorkbook(syntheticMasterSheets());
    const exported = reportAiMastersToSheets(parsed).map((s) => ({
      name: s.name,
      rows: [s.header, ...s.rows],
    }));
    const again = parseReportAiWorkbook(exported);
    expect(again.errors).toEqual([]);
    expect(again.warnings).toEqual([]);
    const { rowCounts: _a, warnings: _w, ...first } = parsed;
    const { rowCounts: _b, warnings: _x, ...second } = again;
    expect(second).toEqual(first);
  });
});
