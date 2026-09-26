import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReceiptImage, ReceiptsController } from '../hooks/useReceipts';
import { ReceiptSection } from './ReceiptSection';

function controller(images: ReceiptImage[]): ReceiptsController {
  return {
    images,
    handoff: '',
    setHandoff: vi.fn(),
    duplicateWarning: null,
    sending: false,
    canAddMore: true,
    reset: vi.fn(),
    addFiles: vi.fn(async () => {}),
    removeImage: vi.fn(),
    updateImage: vi.fn(),
    setCompanyPaid: vi.fn(),
    send: vi.fn(async () => {}),
  };
}

const image = (id: number, companyPaid: boolean): ReceiptImage => ({
  id,
  data: 'data:image/jpeg;base64,AA==',
  amount: '500',
  storeName: '駐車場',
  receiptDate: '2026-09-25T10:00',
  companyPaid,
  loading: false,
});

describe('ReceiptSection', () => {
  it('写真ごとに「会社負担(お客様に請求しない)」を付け外しでき、入力が変わったことを知らせる', () => {
    const receipts = controller([image(1, false), image(2, true)]);
    const onEdited = vi.fn();
    render(<ReceiptSection hidden={false} receipts={receipts} onSend={() => {}} onEdited={onEdited} />);
    const boxes = screen.getAllByRole('checkbox', {
      name: '会社負担(お客様に請求しない)',
    }) as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    fireEvent.click(boxes[0] as HTMLInputElement);
    expect(receipts.setCompanyPaid).toHaveBeenCalledWith(1, true);
    fireEvent.click(boxes[1] as HTMLInputElement);
    expect(receipts.setCompanyPaid).toHaveBeenCalledWith(2, false);
    expect(onEdited).toHaveBeenCalledTimes(2);
  });
});
