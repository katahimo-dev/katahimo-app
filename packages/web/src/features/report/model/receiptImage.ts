import { jstDateString, jstHHmm } from '../../../lib/date';

/**
 * 領収書の写真まわりの小さな計算(GAS版 resizeAndAddImage / toDatetimeLocalFormat /
 * fromDatetimeLocalFormat / getNowDatetimeLocal)。
 */

export const MAX_RECEIPT_IMAGES = 6;
export const RECEIPT_IMAGE_MAX_SIZE = 1200;
export const RECEIPT_IMAGE_JPEG_QUALITY = 0.7;

/**
 * 長い辺が 1200px を越えるときだけ、縦横比を保って縮める(GAS版と同じく、横長なら幅、縦長・正方形なら高さで判定)。
 * 小数のまま返す(canvas の幅・高さに入れると整数に切り捨てられる。GAS版と同じ)。
 */
export function computeResizedSize(
  width: number,
  height: number,
  max = RECEIPT_IMAGE_MAX_SIZE,
): { width: number; height: number } {
  let w = width;
  let h = height;
  if (w > h) {
    if (w > max) {
      h *= max / w;
      w = max;
    }
  } else if (h > max) {
    w *= max / h;
    h = max;
  }
  return { width: w, height: h };
}

/** OCRの 'yyyy/MM/dd HH:mm'(時刻なしも可)→ datetime-local の 'yyyy-MM-ddTHH:mm'。読めなければ空文字。 */
export function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  const m = value.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s(\d{1,2}):(\d{1,2}))?$/);
  if (!m) return '';
  const hh = (m[4] || '00').padStart(2, '0');
  const mm = (m[5] || '00').padStart(2, '0');
  return `${m[1]}-${m[2]}-${m[3]}T${hh}:${mm}`;
}

/** datetime-local の 'yyyy-MM-ddTHH:mm' → サーバーに送る 'yyyy/MM/dd HH:mm' */
export function fromDatetimeLocal(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/-/g, '/').replace('T', ' ');
}

/** 今の日時(分まで。日本時間)の datetime-local 値 */
export function nowDatetimeLocal(now: Date | number = Date.now()): string {
  return `${jstDateString(now)}T${jstHHmm(now)}`;
}

/**
 * ブラウザで写真を読み込み、縮めて JPEG(品質0.7)の data URL にする(GAS版 resizeAndAddImage)。
 * 元の写真は data URL にしない(数MBの写真を base64 の文字列にすると、その分メモリを使うため)。
 * createImageBitmap / OffscreenCanvas が使えるブラウザではそれを使い、使えなければ <img> と <canvas> で行う。
 */
export async function resizeImageFile(file: Blob): Promise<string> {
  const jpeg =
    typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function'
      ? await resizeWithBitmap(file)
      : await resizeWithImageElement(file);
  return blobToDataUrl(jpeg);
}

async function resizeWithBitmap(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = computeResizedSize(bitmap.width, bitmap.height);
    // canvas の幅・高さは整数に切り捨てられる(GAS版と同じ)。描くときは小数のまま
    const canvas = new OffscreenCanvas(Math.trunc(width), Math.trunc(height));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: RECEIPT_IMAGE_JPEG_QUALITY });
  } finally {
    bitmap.close();
  }
}

async function resizeWithImageElement(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = computeResizedSize(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('写真を縮められませんでした'))),
        'image/jpeg',
        RECEIPT_IMAGE_JPEG_QUALITY,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}
