import { decodeReceiptImage } from '@katahimo/core/domain';
import { describe, expect, it } from 'vitest';
import { demoReceiptImageDataUrl } from './receiptImages';

describe('demoReceiptImageDataUrl', () => {
  it('receiptImage.ts の検証を通る、正しい PNG になる', () => {
    const decoded = decodeReceiptImage(demoReceiptImageDataUrl(1), 1_500_000);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.contentType).toBe('image/png');
  });

  it('違う seed は違う画像(中身のバイト列)になる(重複判定で潰れないように)', () => {
    const images = Array.from({ length: 10 }, (_, i) => demoReceiptImageDataUrl(i + 1));
    expect(new Set(images).size).toBe(images.length);
  });
});
