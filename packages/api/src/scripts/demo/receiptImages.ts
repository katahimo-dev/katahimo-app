import { deflateSync } from 'node:zlib';

/**
 * 公開デモの領収書アップロードで使う、ごく小さい合成PNG画像。
 *
 * 領収書アップロード(uploadReceipts)は画像の先頭バイト列(マジックナンバー)で種類を判定し、内容が同じ画像は
 * 重複として弾く(receiptImage.ts / receipts.ts の dedupe_hash)。デモでは複数枚を登録したいので、1枚ごとに
 * 色を変えたPNGを自前で組み立てて(外部ファイルを持ち込まない)、確実にバイト列を変える。
 */

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ (buf[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 単色の正方形PNG(8bit RGB、フィルタなし)を組み立てて data URL にする。 */
export function solidColorPngDataUrl(color: readonly [number, number, number], size = 8): string {
  const [r, g, b] = color;
  const rowBytes = 1 + size * 3;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // フィルタタイプ 0(none)
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** seed から、はっきり違う色(重複判定に使う内容が確実に変わる)を作る。 */
export function demoReceiptColorFromSeed(seed: number): [number, number, number] {
  const r = 40 + ((seed * 53) % 200);
  const g = 40 + ((seed * 97) % 200);
  const b = 40 + ((seed * 131) % 200);
  return [r, g, b];
}

/** デモの領収書アップロード用画像(data URL)。同じ seed は同じ画像、違う seed は違う画像になる。 */
export function demoReceiptImageDataUrl(seed: number): string {
  return solidColorPngDataUrl(demoReceiptColorFromSeed(seed));
}
