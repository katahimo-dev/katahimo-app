import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assembleDailyReportPrompt,
  type ParsedReportAiImport,
  parseReportAiWorkbook,
  type ReportAiMasters,
  reportAiMastersToSheets,
} from '@katahimo/core/domain';
import { syntheticMasterSheets, syntheticPasteBlockSheet } from '@katahimo/core/test-utils';
import { AI_PROMPT_KEYS, findAiPromptDefinition } from '@katahimo/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildReportAiWorkbook, readReportAiWorkbook } from './reportAiWorkbook';

/** 架空の中身のマスターを、お客様の xlsx と同じ形(注記の結合セル・書式つきの文字・式のセル)の xlsx にする。 */
async function syntheticWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of [...syntheticMasterSheets(), syntheticPasteBlockSheet()]) {
    const ws = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) ws.addRow([...row]);
    if (sheet.name.startsWith('04_')) ws.mergeCells('A1:C1');
  }
  const keywords = workbook.getWorksheet('01_マスター表') as ExcelJS.Worksheet;
  keywords.getCell('C2').value = { richText: [{ text: '語' }, { font: { bold: true }, text: 'A' }] };
  keywords.getCell('F2').value = { formula: '12*3', result: 36 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** 取り込んだ中身をプロンプトの組み立てに渡す形にする(ID は仮の値)。 */
function mastersOf(parsed: ParsedReportAiImport): ReportAiMasters {
  const id = (i: number) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`;
  return {
    keywords: parsed.keywords.map((k, i) => ({ ...k, id: id(i) })),
    ageBands: parsed.ageBands.map((b, i) => ({ ...b, id: id(100 + i) })),
    educationLevels: parsed.educationLevels,
    psiLevels: parsed.psiLevels,
    phrases: parsed.phrases.map((p, i) => ({ ...p, id: id(200 + i) })),
    stanceRules: parsed.stanceRules.map((s, i) => ({ ...s, id: id(300 + i) })),
  };
}

describe('日報AIの調整の xlsx', () => {
  it('お客様の xlsx と同じ形のファイルを誤り無く読む(結合セルは左上だけ・書式つきの文字・式の結果)', async () => {
    const parsed = parseReportAiWorkbook(await readReportAiWorkbook(await syntheticWorkbook()));
    expect(parsed.errors).toEqual([]);
    expect(parsed.keywords.map((k) => k.code)).toEqual(['K01', 'K02', 'K03', 'K09']);
    expect(parsed.keywords[0]).toMatchObject({ keyword: '語A', ageFromMonths: 36 });
    expect(parsed.psiLevels).toHaveLength(5);
    expect(parsed.rowCounts.phrases).toBe(3);
  });

  it('書き出したファイルを取り込むと同じ中身になる', async () => {
    const parsed = parseReportAiWorkbook(syntheticMasterSheets());
    const body = await buildReportAiWorkbook(reportAiMastersToSheets(parsed));
    const again = parseReportAiWorkbook(await readReportAiWorkbook(body));
    expect(again.errors).toEqual([]);
    expect(again.keywords).toEqual(parsed.keywords);
    expect(again.ageBands).toEqual(parsed.ageBands);
    expect(again.educationLevels).toEqual(parsed.educationLevels);
    expect(again.psiLevels).toEqual(parsed.psiLevels);
    expect(again.phrases).toEqual(parsed.phrases);
    expect(again.stanceRules).toEqual(parsed.stanceRules);
  });

  it('xlsx でないファイルは 400', async () => {
    await expect(readReportAiWorkbook(Buffer.from('not a workbook'))).rejects.toMatchObject({
      code: 'validation_failed',
      reason: 'invalid_xlsx',
    });
  });
});

/**
 * お客様の実際のファイル(リポジトリには置かない。.scratch-ai/ は git の対象外)があるときだけ確かめる。
 */
const SCRATCH = fileURLToPath(new URL('../../../../.scratch-ai/', import.meta.url));
const MASTER_FILE = `${SCRATCH}日報キーワード表現マスター.xlsx`;
const PROPOSAL_FILE = `${SCRATCH}プロンプト変更案.xlsx`;

describe.skipIf(!existsSync(MASTER_FILE))('お客様の日報キーワード表現マスター(手元にあるときだけ)', () => {
  it('誤り無く全ての表を読む', async () => {
    const parsed = parseReportAiWorkbook(await readReportAiWorkbook(readFileSync(MASTER_FILE)));
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.map((w) => w.sheet)).toEqual(['00_使い方', '07_参照フロー図']);
    expect(parsed.rowCounts).toEqual({
      keywords: 24,
      ageBands: 8,
      educationLevels: 5,
      psiLevels: 5,
      phrases: 20,
      stanceRules: 8,
    });
    expect(parsed.phrases.filter((p) => p.kind === 'warm')).toHaveLength(12);
    expect(parsed.phrases.filter((p) => p.kind === 'avoid')).toHaveLength(8);
    // 書き出して取り込み直しても同じ
    const again = parseReportAiWorkbook(
      await readReportAiWorkbook(await buildReportAiWorkbook(reportAiMastersToSheets(parsed))),
    );
    expect(again.errors).toEqual([]);
    expect(again.keywords).toEqual(parsed.keywords);
  });
});

describe.skipIf(!existsSync(MASTER_FILE) || !existsSync(PROPOSAL_FILE))(
  'お客様のプロンプト変更案(手元にあるときだけ)',
  () => {
    it('貼付用のキーワード表を誤り無く読む', async () => {
      const sheets = await readReportAiWorkbook(readFileSync(PROPOSAL_FILE));
      const parsed = parseReportAiWorkbook(sheets);
      expect(parsed.errors).toEqual([]);
      expect(parsed.rowCounts.keywords).toBe(24);
    });

    it('実際のマスターを入れた既定のプロンプトに、変更案の全文の追加箇所(🟥)が全て入る', async () => {
      const masters = mastersOf(parseReportAiWorkbook(await readReportAiWorkbook(readFileSync(MASTER_FILE))));
      const { prompt } = assembleDailyReportPrompt({
        template: findAiPromptDefinition(AI_PROMPT_KEYS.DAILY_REPORT_GENERATE)?.defaultBody ?? '',
        companyPolicy: '',
        anonymizedText: 'メモ',
        timeInfo: '17:00〜19:00',
        childAgeMonths: 30,
        educationLevel: 3,
        riskRating: 4,
        masters,
      });
      const [, fullText] = await readReportAiWorkbook(readFileSync(PROPOSAL_FILE));
      const added = (fullText?.rows ?? [])
        .map((row) => String(row[1] ?? ''))
        .filter((text) => text.startsWith('🟥'))
        .map((text) => text.replace(/^🟥/, '').trim());
      expect(added.length).toBeGreaterThan(30);
      const lines = prompt.split('\n').map((l) => l.trim());
      const missing = added.filter((line) => {
        // 変更案の {変数} は値(または注記の変数名)に置き換わる
        const pattern = new RegExp(
          `^${line
            .split(/\{\w+\}/)
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.+?')}$`,
        );
        return !lines.some((l) => pattern.test(l));
      });
      expect(missing).toEqual([]);
      // 末尾の表は3軸で絞り込んだ候補(変更案の列の並び)
      expect(prompt).toMatch(/\nK\d{2}｜[^｜\n]+｜[^｜\n]+｜[^｜\n]*\(\d+-\d+\)｜[\d-]+｜\d｜/);
    });
  },
);
