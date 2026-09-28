import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { receiptsApi } from '../../../api/receipts';
import { createWrapper } from '../../../test/providers';
import { resizeImageFile } from '../model/receiptImage';
import type { ReportSession } from '../types';
import { useReportController } from './useReportController';

vi.mock('../../../api/receipts', () => ({ receiptsApi: { ocr: vi.fn(), upload: vi.fn() } }));
vi.mock('../model/receiptImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/receiptImage')>()),
  resizeImageFile: vi.fn(),
}));
vi.mock('../../../api/system', () => ({
  systemApi: { uiConfig: vi.fn(() => new Promise(() => undefined)), dataVersion: vi.fn() },
}));

const upload = vi.mocked(receiptsApi.upload);
const standalone = (nonce: number): ReportSession => ({ kind: 'standalone', nonce });
const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('お客様の指定なしの領収書の既定の日時', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(resizeImageFile).mockImplementation(async (f) => `data:image/jpeg;base64,${(f as File).name}`);
    vi.mocked(receiptsApi.ocr).mockResolvedValue({
      result: { amount: 500, storeName: '駐車場', receiptDate: '' },
    } as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T05:37:00Z')); // 14:37(JST)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openWithUndatedReceipt() {
    const hook = renderHook(({ session }) => useReportController(session), {
      initialProps: { session: standalone(1) as ReportSession | null },
      wrapper: createWrapper(),
    });
    await act(async () => {
      await hook.result.current.receipts.addFiles([file('a')]);
    });
    const id = hook.result.current.receipts.images[0]?.id ?? -1;
    act(() => hook.result.current.receipts.updateImage(id, 'receiptDate', ''));
    return hook;
  }

  it('送る時点の日時(日本時間)を使い、隠れている日報の日付・時刻(既定の 09:00)は使わない', async () => {
    upload.mockResolvedValue({ success: true, message: '領収書を送りました', duplicates: [] } as never);
    const { result } = await openWithUndatedReceipt();
    await act(async () => {
      result.current.sendReceipts();
    });
    expect(upload.mock.calls[0]?.[0].receiptTimestamp).toBe('2026/09/28 14:37:00');
  });

  it('通信に失敗して1分以上たって送り直しても、最初に送ろうとした日時のまま(重複の判定が変わらない)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    upload.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    upload.mockResolvedValue({ success: true, message: '領収書を送りました', duplicates: [] } as never);
    const { result } = await openWithUndatedReceipt();
    await act(async () => {
      result.current.sendReceipts();
    });
    vi.setSystemTime(new Date('2026-09-28T05:40:00Z'));
    await act(async () => {
      result.current.sendReceipts();
    });
    expect(upload.mock.calls.map((c) => c[0].receiptTimestamp)).toEqual([
      '2026/09/28 14:37:00',
      '2026/09/28 14:37:00',
    ]);
  });

  it('全て送れたあとの次の写真は、その時点の日時にする', async () => {
    upload.mockResolvedValue({ success: true, message: '領収書を送りました', duplicates: [] } as never);
    const { result } = await openWithUndatedReceipt();
    await act(async () => {
      result.current.sendReceipts();
    });
    vi.setSystemTime(new Date('2026-09-28T06:00:00Z')); // 15:00(JST)
    await act(async () => {
      await result.current.receipts.addFiles([file('b')]);
    });
    const id = result.current.receipts.images[0]?.id ?? -1;
    act(() => result.current.receipts.updateImage(id, 'receiptDate', ''));
    await act(async () => {
      result.current.sendReceipts();
    });
    expect(upload.mock.calls.at(-1)?.[0].receiptTimestamp).toBe('2026/09/28 15:00:00');
  });
});
