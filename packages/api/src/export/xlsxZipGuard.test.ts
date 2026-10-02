import { deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readXlsxSheets, withXlsxReadSlot } from './xlsxSheets';
import { inspectZip, XLSX_ZIP_LIMITS } from './xlsxZipGuard';

interface TestEntry {
  name: string;
  data: Buffer;
  /** 0 = 無圧縮、8 = deflate(既定)。 */
  method?: number;
  flags?: number;
  /** 目次に書く展開後の大きさ(偽る試験用。省けば本当の大きさ)。 */
  declaredSize?: number;
}

/** 試験用の zip を組み立てる(CRC は 0。inspectZip は CRC を見ない)。 */
function buildZip(entries: TestEntry[], options: { prefix?: Buffer; zip64Locator?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  // prefix は後から前に足したバイト(目次の位置はずらさない。JSZip が読む位置をずらす場合)
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name);
    const size = entry.declaredSize ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDir = Buffer.concat(centrals);
  const locator = Buffer.alloc(options.zip64Locator ? 20 : 0);
  if (options.zip64Locator) locator.writeUInt32LE(0x07064b50, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([options.prefix ?? Buffer.alloc(0), ...locals, centralDir, locator, eocd]);
}

const MIB = 1024 * 1024;

describe('xlsx の展開爆弾の確かめ(inspectZip)', () => {
  it('exceljs で作ったふつうの xlsx は通る', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('スタッフ');
    ws.addRow(['氏名', 'メールアドレス']);
    for (let i = 0; i < 500; i++) ws.addRow([`スタッフ${i}`, `s${i}@example.com`]);
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = inspectZip(body);
    expect(result).toMatchObject({ ok: true });
    expect(
      (await readXlsxSheets(body, { maxSheets: 5, maxRows: 1000, maxColumns: 5 }))[0]?.rows,
    ).toHaveLength(501);
  });

  it('小さな本体で大きく膨らむファイル(圧縮率の高い 0 の並び)は断る', () => {
    const bomb = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(4 * MIB) }]);
    expect(bomb.length).toBeLessThan(100 * 1024);
    expect(inspectZip(bomb)).toEqual({ ok: false, reason: 'ratio_too_high' });
    // 圧縮率の上限を外しても、1つのファイル(5MB)・合計(8MB)の上限で止まる
    const loose = { ...XLSX_ZIP_LIMITS, maxCompressionRatio: 10_000 };
    expect(inspectZip(buildZip([{ name: 'a.xml', data: Buffer.alloc(5 * MIB) }]), loose)).toMatchObject({
      ok: true,
    });
    expect(inspectZip(buildZip([{ name: 'a.xml', data: Buffer.alloc(5 * MIB + 1) }]), loose)).toEqual({
      ok: false,
      reason: 'entry_too_large',
    });
    const many = Array.from({ length: 3 }, (_, i) => ({ name: `a${i}.xml`, data: Buffer.alloc(3 * MIB) }));
    expect(inspectZip(buildZip(many), loose)).toEqual({ ok: false, reason: 'total_too_large' });
  });

  it('目次の展開後の大きさを小さく偽ったファイルは、実際に展開して上限を超えた所で断る', () => {
    const lying = buildZip([
      { name: 'xl/sharedStrings.xml', data: Buffer.alloc(5 * MIB, 0x61), declaredSize: 1000 },
    ]);
    expect(inspectZip(lying)).toEqual({ ok: false, reason: 'size_mismatch' });
    const stored = buildZip([{ name: 'a.xml', data: Buffer.from('abc'), method: 0, declaredSize: 2 }]);
    expect(inspectZip(stored)).toEqual({ ok: false, reason: 'size_mismatch' });
  });

  it('ファイルが多すぎる・暗号化・ZIP64・未知の圧縮方式・前に余分なバイトのある zip は断る', () => {
    const tiny = (name: string): TestEntry => ({ name, data: Buffer.from('x') });
    expect(inspectZip(buildZip(Array.from({ length: 201 }, (_, i) => tiny(`f${i}`))))).toEqual({
      ok: false,
      reason: 'too_many_entries',
    });
    expect(inspectZip(buildZip([{ ...tiny('a'), flags: 1 }]))).toEqual({ ok: false, reason: 'encrypted' });
    expect(inspectZip(buildZip([tiny('a')], { zip64Locator: true }))).toEqual({ ok: false, reason: 'zip64' });
    expect(inspectZip(buildZip([{ ...tiny('a'), method: 12 }]))).toEqual({
      ok: false,
      reason: 'unsupported_method',
    });
    expect(inspectZip(buildZip([tiny('a')], { prefix: Buffer.from('PK\x03\x04junk') }))).toEqual({
      ok: false,
      reason: 'corrupt',
    });
    expect(inspectZip(Buffer.from('not a zip at all, just text'))).toEqual({ ok: false, reason: 'not_zip' });
  });

  it('readXlsxSheets は exceljs で読む前に 400 で断る(大きすぎる = xlsx_too_large、偽り = invalid_xlsx)', async () => {
    const limits = { maxSheets: 5, maxRows: 1000, maxColumns: 5 };
    await expect(
      readXlsxSheets(buildZip([{ name: 'a.xml', data: Buffer.alloc(6 * MIB) }]), limits),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      reason: 'xlsx_too_large',
      message: 'Excel(.xlsx)のファイルの中身が大きすぎます(展開して合計8MB・中の1つのファイル5MBまで)',
    });
    const tiny = (name: string): TestEntry => ({ name, data: Buffer.from('x') });
    await expect(
      readXlsxSheets(buildZip(Array.from({ length: 201 }, (_, i) => tiny(`f${i}`))), limits),
    ).rejects.toMatchObject({
      reason: 'xlsx_too_large',
      message: 'Excel(.xlsx)のファイルの中のファイルが多すぎます(200個まで)',
    });
    await expect(
      readXlsxSheets(buildZip([{ name: 'a.xml', data: Buffer.alloc(5 * MIB), declaredSize: 10 }]), limits),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'invalid_xlsx' });
  });
});

describe('withXlsxReadSlot', () => {
  it('このインスタンスで同時に1つだけ読み、読んでいる間の2つ目は読まずに断る(終われば次を読める)', async () => {
    let release: () => void = () => {};
    const first = withXlsxReadSlot(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('first');
        }),
    );
    let secondRan = false;
    const second = await withXlsxReadSlot(async () => {
      secondRan = true;
      return 'second';
    });
    expect(second).toEqual({ ok: false });
    expect(secondRan).toBe(false);
    release();
    expect(await first).toEqual({ ok: true, value: 'first' });
    expect(await withXlsxReadSlot(async () => 'third')).toEqual({ ok: true, value: 'third' });
    // 読む処理が失敗しても枠は空く
    await expect(withXlsxReadSlot(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await withXlsxReadSlot(async () => 'fourth')).toEqual({ ok: true, value: 'fourth' });
  });
});
