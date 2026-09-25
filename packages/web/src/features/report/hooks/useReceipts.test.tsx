import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receiptsApi } from '../../../api/receipts';
import { deferred, TEST_USER } from '../../../test/providers';
import { toastStore } from '../../../ui/toast/toastStore';
import { resizeImageFile } from '../model/receiptImage';
import { IMAGE_LOAD_FAILED_MESSAGE, type ReceiptSendContext, useReceipts } from './useReceipts';

vi.mock('../../../api/receipts', () => ({ receiptsApi: { ocr: vi.fn(), upload: vi.fn() } }));
vi.mock('../model/receiptImage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../model/receiptImage')>();
  return { ...original, resizeImageFile: vi.fn() };
});

const resize = vi.mocked(resizeImageFile);
const ocr = vi.mocked(receiptsApi.ocr);
const upload = vi.mocked(receiptsApi.upload);
const SCOPE = { tenantId: TEST_USER.tenantId, staffId: TEST_USER.staffId };
const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
const ctx: ReceiptSendContext = {
  staffName: TEST_USER.name,
  customerId: 'c1',
  customerName: '田中 さくら',
  fallbackTimestamp: '2026/09/25 09:00:00',
};

describe('useReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastStore.hide();
    resize.mockImplementation(async (f) => `data:image/jpeg;base64,${(f as File).name}`);
    ocr.mockResolvedValue({ result: { amount: 0, storeName: '', receiptDate: '2026/09/25 10:00' } } as never);
  });

  it('縮めている途中の写真も6枚までの数に入れる(続けて選んでも越えない)', async () => {
    const pending = deferred<string>();
    resize.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useReceipts(SCOPE));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.addFiles([file('a'), file('b'), file('c'), file('d')]);
    });
    await act(async () => {
      await result.current.addFiles([file('e'), file('f'), file('g')]);
    });
    expect(toastStore.getState()).toMatchObject({ message: '写真は6枚までです', isError: true });

    await act(async () => {
      pending.resolve('data:image/jpeg;base64,a');
      await first;
    });
    expect(result.current.images).toHaveLength(4);
  });

  it('読み込めない写真があれば知らせ、読めた写真は足す', async () => {
    resize.mockRejectedValueOnce(new Error('decode failed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useReceipts(SCOPE));
    await act(async () => {
      await result.current.addFiles([file('broken'), file('ok')]);
    });
    expect(result.current.images.map((i) => i.data)).toEqual(['data:image/jpeg;base64,ok']);
    expect(toastStore.getState()).toMatchObject({ message: IMAGE_LOAD_FAILED_MESSAGE, isError: true });
    // 失敗した分の枠は空く(あと5枚足せる)
    await act(async () => {
      await result.current.addFiles([1, 2, 3, 4, 5].map((n) => file(`n${n}`)));
    });
    expect(result.current.images).toHaveLength(6);
  });

  it('送っている間は写真を消せない。重複だった写真だけを(IDで)残す', async () => {
    const { result } = renderHook(() => useReceipts(SCOPE));
    await act(async () => {
      await result.current.addFiles([file('a'), file('b'), file('c')]);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const [a, b, c] = result.current.images;
    if (!a || !b || !c) throw new Error('unreachable');

    const pending = deferred<Awaited<ReturnType<typeof receiptsApi.upload>>>();
    upload.mockReturnValueOnce(pending.promise);
    let sending: Promise<void> = Promise.resolve();
    act(() => {
      sending = result.current.send(ctx);
    });
    expect(result.current.sending).toBe(true);

    act(() => result.current.removeImage(a.id));
    expect(result.current.images).toHaveLength(3);

    await act(async () => {
      pending.resolve({
        success: true,
        message: '1件は前に登録してあります',
        uploadedCount: 2,
        duplicateCount: 1,
        duplicates: [{ index: 1, timestamp: '2026/09/25 10:00', amount: '0', storeName: '' }],
        uploadBatchId: null,
      });
      await sending;
    });
    expect(result.current.images.map((i) => i.id)).toEqual([b.id]);
    expect(result.current.duplicateWarning).not.toBeNull();
    expect(result.current.sending).toBe(false);
  });
});
