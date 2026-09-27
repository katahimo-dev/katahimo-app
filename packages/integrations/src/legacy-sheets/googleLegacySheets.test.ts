import { describe, expect, it } from 'vitest';
import {
  GoogleLegacyDriveFiles,
  GoogleLegacySpreadsheetReader,
  LEGACY_SHEET_ROWS_PER_REQUEST,
  type LegacyDriveApi,
  type LegacySheetsApi,
  quoteSheetName,
} from './googleLegacySheets';

/** Sheets API の代わり(シート名 → 行。表示の文字列と値を別々に持つ)。 */
function fakeSheetsApi(
  sheets: { title: string; rowCount: number; texts: unknown[][]; values: unknown[][] }[],
  calls: string[] = [],
): LegacySheetsApi {
  return {
    async listSheets() {
      return sheets.map(({ title, rowCount }) => ({ title, rowCount }));
    },
    async getValues(_id, range, render) {
      calls.push(`${render} ${range}`);
      const match = /^'(.+)'!(\d+):(\d+)$/.exec(range);
      if (!match) throw new Error(`範囲の形が違います: ${range}`);
      const sheet = sheets.find((s) => s.title === match[1]?.replaceAll("''", "'"));
      const rows = (render === 'formatted' ? sheet?.texts : sheet?.values) ?? [];
      const slice = rows.slice(Number(match[2]) - 1, Number(match[3]));
      // Sheets API は範囲の後ろの空の行を返さない
      while (slice.length > 0 && (slice.at(-1)?.length ?? 0) === 0) slice.pop();
      return slice;
    },
  };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

describe('GoogleLegacySpreadsheetReader(Sheets API でシートを読む)', () => {
  it('表示の文字列と書式を付けない値をセルごとに合わせ、シート名で選ぶ(省略は先頭のシート)', async () => {
    const reader = new GoogleLegacySpreadsheetReader(
      fakeSheetsApi([
        {
          title: '領収書',
          rowCount: 10,
          texts: [
            ['日時', '金額'],
            ['2026/09/05 9:00:00', '¥1,200'],
          ],
          values: [
            ['日時', '金額'],
            [46270.375, 1200],
          ],
        },
        { title: "日報's", rowCount: 10, texts: [['Timestamp']], values: [['Timestamp']] },
      ]),
    );
    const first = await reader.readSheet('id', null);
    expect(first).toEqual({
      title: '領収書',
      rows: [
        [
          { value: '日時', text: '日時' },
          { value: '金額', text: '金額' },
        ],
        [
          { value: 46270.375, text: '2026/09/05 9:00:00' },
          { value: 1200, text: '¥1,200' },
        ],
      ],
    });
    expect((await reader.readSheet('id', "日報's")).title).toBe("日報's");
    await expect(reader.readSheet('id', '事故報告')).rejects.toThrow('シート「事故報告」がありません');
  });

  it('大きなシートは分けて読み、途中の空の行も行番号がずれないように残す', async () => {
    const total = LEGACY_SHEET_ROWS_PER_REQUEST + 5;
    const texts: unknown[][] = Array.from({ length: total }, (_, i) => [`r${i + 1}`]);
    // 1つ目の範囲の最後の10行は空
    for (let i = LEGACY_SHEET_ROWS_PER_REQUEST - 10; i < LEGACY_SHEET_ROWS_PER_REQUEST; i++) texts[i] = [];
    const calls: string[] = [];
    const reader = new GoogleLegacySpreadsheetReader(
      fakeSheetsApi([{ title: '日報', rowCount: total + 100, texts, values: texts }], calls),
    );
    const sheet = await reader.readSheet('id', '日報');
    expect(sheet.rows).toHaveLength(total);
    expect(sheet.rows[LEGACY_SHEET_ROWS_PER_REQUEST]?.[0]?.text).toBe(
      `r${LEGACY_SHEET_ROWS_PER_REQUEST + 1}`,
    );
    expect(sheet.rows[LEGACY_SHEET_ROWS_PER_REQUEST - 1]).toEqual([]);
    expect(calls).toEqual([
      `formatted '日報'!1:${LEGACY_SHEET_ROWS_PER_REQUEST}`,
      `unformatted '日報'!1:${LEGACY_SHEET_ROWS_PER_REQUEST}`,
      `formatted '日報'!${LEGACY_SHEET_ROWS_PER_REQUEST + 1}:${total + 100}`,
      `unformatted '日報'!${LEGACY_SHEET_ROWS_PER_REQUEST + 1}:${total + 100}`,
    ]);
  });

  it('スプレッドシートを読めない(共有されていない)ときは共有を確かめる案内の例外', async () => {
    const reader = new GoogleLegacySpreadsheetReader({
      listSheets: async () => {
        throw httpError(403);
      },
      getValues: async () => [],
    });
    await expect(reader.readSheet('id', null)).rejects.toThrow(/HTTP 403.*共有/);
  });

  it('シート名は A1 表記の引用符で囲む', () => {
    expect(quoteSheetName("O'Brien")).toBe("'O''Brien'");
  });
});

describe('GoogleLegacyDriveFiles(Drive API で画像を読む)', () => {
  const api = (overrides: Partial<LegacyDriveApi>): LegacyDriveApi => ({
    getFile: async () => ({ id: 'f', mimeType: 'image/jpeg', size: '123', trashed: false }),
    download: async () => new Uint8Array([1, 2]).buffer,
    ...overrides,
  });

  it('メタデータの大きさを数値にし、無い・共有されていないファイルは null(他の失敗は例外)', async () => {
    expect(await new GoogleLegacyDriveFiles(api({})).getFile('f')).toEqual({
      id: 'f',
      mimeType: 'image/jpeg',
      byteSize: 123,
      trashed: false,
    });
    for (const status of [403, 404]) {
      const files = new GoogleLegacyDriveFiles(
        api({
          getFile: async () => {
            throw httpError(status);
          },
        }),
      );
      expect(await files.getFile('f')).toBeNull();
    }
    const failing = new GoogleLegacyDriveFiles(
      api({
        getFile: async () => {
          throw httpError(500);
        },
      }),
    );
    await expect(failing.getFile('f')).rejects.toThrow('HTTP 500');
    expect(await new GoogleLegacyDriveFiles(api({})).download('f')).toEqual(new Uint8Array([1, 2]));
  });
});
