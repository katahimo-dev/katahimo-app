import { inflateRawSync } from 'node:zlib';

/**
 * xlsx(zip)を exceljs(JSZip)に渡す前に、展開した後の大きさを確かめる(展開爆弾の対策)。
 *
 * JSZip は zip の全てのファイルを展開してから中身を読むため、exceljs の読み込みの後のシート・行の上限では、
 * 小さなファイル(上限 2MB。shared の STAFF_IMPORT_MAX_BYTES・REPORT_AI_IMPORT_MAX_BYTES)が何GBにも膨らむファイルを止められない。そこで先に zip の目次(End of Central Directory と
 * Central Directory)を読み、ファイルの数・展開後の大きさ・圧縮率の上限を確かめる。
 *
 * 目次の「展開後の大きさ」は書き換えられる(JSZip は目次の値を信じずに最後まで展開する)ため、目次の値だけでは足りない。
 * 各ファイルを、目次の展開後の大きさを上限にして実際に展開し(zlib の maxOutputLength)、目次と合わなければ断る。
 * JSZip と同じ規則で目次・データの位置を決める(EOCD はファイルの最後の署名、データは各ファイルの先頭の見出しの後から
 * 目次の圧縮後の大きさだけ)ので、JSZip が展開する量はここで確かめた量を超えない。
 */

export interface ZipGuardLimits {
  /** ファイル(ディレクトリを含む)の数。 */
  maxEntries: number;
  /** 1つのファイルの展開後の大きさ(バイト)。 */
  maxEntryBytes: number;
  /** 全てのファイルの展開後の大きさの合計(バイト)。 */
  maxTotalBytes: number;
  /** 圧縮率(展開後 / 圧縮後)の上限。展開後が ratioCheckMinBytes を超えるファイルだけに当てる。 */
  maxCompressionRatio: number;
  ratioCheckMinBytes: number;
}

const MIB = 1024 * 1024;

/**
 * 管理画面の xlsx の取込の上限(スタッフ・日報AIの調整。ふつうのファイルは数十件・数百KB)。
 *
 * exceljs は展開した XML の数十倍のメモリを使う(展開して 30MB の XML で 230〜570MB)。API は 1 インスタンス 1Gi で
 * 同時に 80 要求を受けるため、展開の上限は本当のファイルに合わせて小さくし、読むのも1インスタンスで1つずつにする
 * (xlsxSheets.ts の withXlsxReadSlot)。書き出したファイルの展開後の大きさ(2026-10 に測った値):
 * - スタッフ 2000 行(シートの行の上限)・ふつうの値: ファイル 148KB、展開して合計 1.6MB(最大のファイル 0.97MB)
 * - スタッフ 2000 行・全ての列を上限の長さまで(重ならない漢字): ファイル 1.5MB、展開して合計 4.5MB(最大 3.4MB)。ピークの RSS は +50MB 程度
 * - 日報AIの調整のマスター 2000 行・長い文(重ならない漢字。ファイルは 2.8MB で上限を超える): 展開して合計 8.2MB(最大 7.0MB)。
 *   2MB のファイルに収まる量(約1400行)なら合計 6MB 程度。本当のマスターは百行ほど・数百KB
 */
export const XLSX_ZIP_LIMITS: ZipGuardLimits = {
  maxEntries: 200,
  maxEntryBytes: 5 * MIB,
  maxTotalBytes: 8 * MIB,
  maxCompressionRatio: 200,
  ratioCheckMinBytes: 1 * MIB,
};

export type ZipGuardReason =
  | 'not_zip'
  | 'corrupt'
  | 'zip64'
  | 'encrypted'
  | 'unsupported_method'
  | 'too_many_entries'
  | 'entry_too_large'
  | 'total_too_large'
  | 'ratio_too_high'
  | 'size_mismatch';

export type ZipGuardResult =
  | { ok: true; entries: number; totalBytes: number }
  | { ok: false; reason: ZipGuardReason };

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

/** JSZip(ArrayReader.lastIndexOfSignature)と同じく、ファイルの最後の署名の位置。 */
function lastIndexOfSignature(body: Buffer, signature: number): number {
  for (let i = body.length - 4; i >= 0; i--) {
    if (body.readUInt32LE(i) === signature) return i;
  }
  return -1;
}

const fail = (reason: ZipGuardReason): ZipGuardResult => ({ ok: false, reason });

/** zip の目次と中身を確かめる(展開した中身は捨てる)。 */
export function inspectZip(body: Buffer, limits: ZipGuardLimits = XLSX_ZIP_LIMITS): ZipGuardResult {
  if (body.length < EOCD_LENGTH || body.readUInt32LE(0) !== SIG_LOCAL) return fail('not_zip');
  const eocd = lastIndexOfSignature(body, SIG_EOCD);
  if (eocd < 0 || eocd + EOCD_LENGTH > body.length) return fail('not_zip');
  const diskNumber = body.readUInt16LE(eocd + 4);
  const diskWithCentralDir = body.readUInt16LE(eocd + 6);
  const entriesOnDisk = body.readUInt16LE(eocd + 8);
  const totalEntries = body.readUInt16LE(eocd + 10);
  const centralDirSize = body.readUInt32LE(eocd + 12);
  const centralDirOffset = body.readUInt32LE(eocd + 16);
  const commentLength = body.readUInt16LE(eocd + 20);
  if (
    diskNumber === MAX16 ||
    diskWithCentralDir === MAX16 ||
    entriesOnDisk === MAX16 ||
    totalEntries === MAX16 ||
    centralDirSize === MAX32 ||
    centralDirOffset === MAX32 ||
    (eocd >= 20 && body.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR)
  ) {
    return fail('zip64');
  }
  if (diskNumber !== 0 || diskWithCentralDir !== 0 || entriesOnDisk !== totalEntries) return fail('corrupt');
  if (eocd + EOCD_LENGTH + commentLength > body.length) return fail('corrupt');
  // 目次は EOCD の直前にぴったり置かれていること(JSZip は前に余分なバイトがあると読む位置をずらすため、ずれは断る)
  if (centralDirOffset + centralDirSize !== eocd) return fail('corrupt');
  if (totalEntries > limits.maxEntries) return fail('too_many_entries');

  let position = centralDirOffset;
  let entries = 0;
  let totalBytes = 0;
  while (position < eocd) {
    if (position + CENTRAL_HEADER_LENGTH > eocd || body.readUInt32LE(position) !== SIG_CENTRAL) {
      return fail('corrupt');
    }
    entries += 1;
    if (entries > limits.maxEntries) return fail('too_many_entries');
    const flags = body.readUInt16LE(position + 8);
    const method = body.readUInt16LE(position + 10);
    const compressedSize = body.readUInt32LE(position + 20);
    const uncompressedSize = body.readUInt32LE(position + 24);
    const nameLength = body.readUInt16LE(position + 28);
    const extraLength = body.readUInt16LE(position + 30);
    const entryCommentLength = body.readUInt16LE(position + 32);
    const diskStart = body.readUInt16LE(position + 34);
    const localOffset = body.readUInt32LE(position + 42);
    position += CENTRAL_HEADER_LENGTH + nameLength + extraLength + entryCommentLength;
    if (position > eocd) return fail('corrupt');

    if (
      compressedSize === MAX32 ||
      uncompressedSize === MAX32 ||
      localOffset === MAX32 ||
      diskStart === MAX16
    ) {
      return fail('zip64');
    }
    // bit 0: 暗号化、bit 6: 強い暗号化
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) return fail('encrypted');
    if (method !== 0 && method !== 8) return fail('unsupported_method');
    if (diskStart !== 0) return fail('corrupt');
    if (uncompressedSize > limits.maxEntryBytes) return fail('entry_too_large');
    totalBytes += uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) return fail('total_too_large');
    if (
      uncompressedSize > limits.ratioCheckMinBytes &&
      uncompressedSize > compressedSize * limits.maxCompressionRatio
    ) {
      return fail('ratio_too_high');
    }

    // データの位置は JSZip(ZipEntry.readLocalPart)と同じく、先頭の見出しの名前・拡張の長さで決める
    if (
      localOffset + LOCAL_HEADER_LENGTH > centralDirOffset ||
      body.readUInt32LE(localOffset) !== SIG_LOCAL
    ) {
      return fail('corrupt');
    }
    const dataStart =
      localOffset +
      LOCAL_HEADER_LENGTH +
      body.readUInt16LE(localOffset + 26) +
      body.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralDirOffset) return fail('corrupt');

    if (method === 0) {
      if (compressedSize !== uncompressedSize) return fail('size_mismatch');
      continue;
    }
    // 目次の展開後の大きさを上限に実際に展開する(目次が小さく偽っていれば上限を超えて止まる)
    let inflated: Buffer;
    try {
      inflated = inflateRawSync(body.subarray(dataStart, dataEnd), {
        maxOutputLength: Math.max(1, uncompressedSize),
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      return fail(code === 'ERR_BUFFER_TOO_LARGE' ? 'size_mismatch' : 'corrupt');
    }
    if (inflated.length !== uncompressedSize) return fail('size_mismatch');
  }
  if (position !== eocd || entries !== totalEntries) return fail('corrupt');
  return { ok: true, entries, totalBytes };
}
