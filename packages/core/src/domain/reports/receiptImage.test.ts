import { describe, expect, it } from 'vitest';
import { decodeReceiptImage, detectReceiptImageType } from './receiptImage';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

describe('領収書画像の検証', () => {
  it('JPEG・PNG・WebP をマジックナンバーで判定する', () => {
    expect(detectReceiptImageType(JPEG)).toBe('image/jpeg');
    expect(detectReceiptImageType(PNG)).toBe('image/png');
    expect(detectReceiptImageType(WEBP)).toBe('image/webp');
    expect(detectReceiptImageType(HTML)).toBeNull();
  });

  it('申告した MIME ではなく中身の種類・拡張子を返す', () => {
    const decoded = decodeReceiptImage(dataUrl('image/jpeg', PNG), 1024);
    expect(decoded).toMatchObject({ ok: true, contentType: 'image/png', extension: 'png' });
  });

  it('画像以外(画像と申告したHTML等)・壊れた値・大きすぎる値は拒否する', () => {
    expect(decodeReceiptImage(dataUrl('image/jpeg', HTML), 1024)).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
    expect(decodeReceiptImage('data:image/jpeg;base64,', 1024)).toEqual({ ok: false, reason: 'malformed' });
    expect(decodeReceiptImage('data:text/html,<b>x</b>', 1024)).toEqual({ ok: false, reason: 'malformed' });
    expect(
      decodeReceiptImage(dataUrl('image/jpeg', Buffer.concat([JPEG, Buffer.alloc(2048)])), 1024),
    ).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('data: の接頭辞の無い base64 本体も受け付ける', () => {
    expect(decodeReceiptImage(JPEG.toString('base64'), 1024)).toMatchObject({
      ok: true,
      contentType: 'image/jpeg',
    });
  });
});
