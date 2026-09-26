/**
 * 領収書画像(data URL)の検証。画像の種類は利用者が申告した data URL の MIME ではなく、先頭のバイト列
 * (マジックナンバー)から判定し、保存する Content-Type・拡張子もそれに合わせる(申告と中身の食い違いで
 * 画像以外のファイルを保存・配信しないようにするため)。
 */
export type ReceiptImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const RECEIPT_IMAGE_EXTENSIONS: Record<ReceiptImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 先頭のバイト列から画像の種類を判定する(JPEG・PNG・WebP 以外は null)。 */
export function detectReceiptImageType(bytes: Uint8Array): ReceiptImageType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // RIFF....WEBP
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export type DecodedReceiptImage =
  | { ok: true; contentType: ReceiptImageType; extension: string; bytes: Uint8Array }
  | { ok: false; reason: 'malformed' | 'too_large' | 'unsupported_type' };

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * `data:<mime>;base64,<本体>` をデコードして検証する。本体だけ(data: の接頭辞なし)の base64 も受け付ける
 * (GAS版の OCR は本体だけを送ることがあったため)。maxBytes はデコード後の大きさの上限。
 */
export function decodeReceiptImage(value: string, maxBytes: number): DecodedReceiptImage {
  const commaIndex = value.indexOf(',');
  const body = (commaIndex >= 0 ? value.slice(commaIndex + 1) : value).replace(/\s+/g, '');
  if (commaIndex >= 0 && !/^data:[^,]*;base64$/i.test(value.slice(0, commaIndex))) {
    return { ok: false, reason: 'malformed' };
  }
  if (!body || !BASE64_BODY.test(body)) return { ok: false, reason: 'malformed' };
  // デコード前に大きさを見積もって、大きすぎるものはデコードしない
  if (Math.floor((body.length * 3) / 4) > maxBytes + 2) return { ok: false, reason: 'too_large' };
  const bytes = new Uint8Array(Buffer.from(body, 'base64'));
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' };
  const contentType = detectReceiptImageType(bytes);
  if (!contentType) return { ok: false, reason: 'unsupported_type' };
  return { ok: true, contentType, extension: RECEIPT_IMAGE_EXTENSIONS[contentType], bytes };
}
