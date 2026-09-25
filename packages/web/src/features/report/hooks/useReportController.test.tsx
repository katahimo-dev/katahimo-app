import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customersApi } from '../../../api/customers';
import { reportsApi } from '../../../api/reports';
import { STORAGE_KEYS, userStorageKey } from '../../../lib/storage';
import { createWrapper, deferred, TEST_USER } from '../../../test/providers';
import { toastStore } from '../../../ui/toast/toastStore';
import type { ReportSession } from '../types';
import { useReportController } from './useReportController';

vi.mock('../../../api/reports', () => ({
  reportsApi: {
    generateDaily: vi.fn(),
    generateAccident: vi.fn(),
    saveDaily: vi.fn(),
    saveAccident: vi.fn(),
    visitComplete: vi.fn(),
  },
}));
vi.mock('../../../api/customers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/customers')>();
  return { ...original, customersApi: { ...original.customersApi, detail: vi.fn() } };
});
vi.mock('../../../api/system', () => ({
  systemApi: { uiConfig: vi.fn(() => new Promise(() => undefined)), dataVersion: vi.fn() },
}));

const saveDaily = vi.mocked(reportsApi.saveDaily);
const generateDaily = vi.mocked(reportsApi.generateDaily);
const SCOPE = { tenantId: TEST_USER.tenantId, staffId: TEST_USER.staffId };
const DRAFT_KEY = userStorageKey(STORAGE_KEYS.pendingReportDraft, SCOPE);

const sessionFor = (customerId: string, nonce: number): ReportSession => ({
  kind: 'customer',
  target: { customerId, customerName: `お客様${customerId}` },
  nonce,
});

type SaveResult = Awaited<ReturnType<typeof reportsApi.saveDaily>>;
const savedReport = (id: string, customerId: string): SaveResult => ({
  success: true,
  message: '保存しました',
  report: {
    id,
    occurredAt: '2026-09-25T00:00:00.000Z',
    staffId: TEST_USER.staffId,
    customerId,
    riskRating: null,
    esRating: null,
    content: { startTime: '09:00', endTime: '11:00', inputText: '', internalText: 'x', customerText: 'y' },
  } as SaveResult['report'],
});

function renderController(initial: ReportSession | null) {
  return renderHook(({ session }) => useReportController(session), {
    initialProps: { session: initial },
    wrapper: createWrapper(),
  });
}

describe('useReportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(customersApi.detail).mockImplementation(() => new Promise(() => undefined));
    toastStore.hide();
  });

  it('入力すると書きかけをその人のキーに退避し、保存できたら消す', async () => {
    const { result } = renderController(sessionFor('c1', 1));
    act(() => result.current.actions.setMemo('公園で外遊び'));
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    expect(draft).toMatchObject({ customerId: 'c1', inputText: '公園で外遊び' });
    // 人ごとに分けたキーだけに書く
    expect(localStorage.getItem(STORAGE_KEYS.pendingReportDraft)).toBeNull();

    saveDaily.mockResolvedValueOnce(savedReport('r1', 'c1'));
    await act(async () => {
      result.current.save();
    });
    await waitFor(() => expect(result.current.form.saved.daily.reportId).toBe('r1'));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(userStorageKey(STORAGE_KEYS.recentCustomers, SCOPE)) ?? '[]'),
    ).toEqual(['c1']);
  });

  it('保存を待つ間に別のお客様で開き直したら、遅れて届いた結果で今の入力を「保存済み」にしない', async () => {
    const { result, rerender } = renderController(sessionFor('c1', 1));
    act(() => result.current.actions.setMemo('前のお客様のメモ'));

    const pending = deferred<SaveResult>();
    saveDaily.mockReturnValueOnce(pending.promise);
    act(() => result.current.save());
    expect(saveDaily).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c1' }));

    // 開き直す(書きかけはGAS版と同じく、次に開いたダイアログにも戻して見せる)
    rerender({ session: sessionFor('c2', 2) });
    expect(result.current.customer?.id).toBe('c2');
    const draftBefore = localStorage.getItem(DRAFT_KEY);
    expect(draftBefore).not.toBeNull();

    await act(async () => {
      pending.resolve(savedReport('r1', 'c1'));
      await pending.promise;
    });

    // 前のお客様の報告IDを持たない(次の保存が前のお客様の報告を上書きしないように)
    expect(result.current.form.saved.daily.reportId).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBe(draftBefore);
    expect(result.current.savingSince).toBeNull();

    saveDaily.mockResolvedValueOnce(savedReport('r2', 'c2'));
    await act(async () => {
      result.current.save();
    });
    expect(saveDaily).toHaveBeenLastCalledWith(
      expect.objectContaining({ customerId: 'c2', reportId: undefined }),
    );
  });

  it('AI生成を待つ間に開き直したら、届いた下書きは捨てる', async () => {
    const { result, rerender } = renderController(sessionFor('c1', 1));
    act(() => result.current.actions.setMemo('メモ'));
    const pending = deferred<Awaited<ReturnType<typeof reportsApi.generateDaily>>>();
    generateDaily.mockReturnValueOnce(pending.promise);
    act(() => result.current.generate());

    rerender({ session: sessionFor('c2', 2) });
    await act(async () => {
      pending.resolve({
        draft: { internal: '前のお客様の日報', customer: '保護者へ', warnings: [] },
      } as never);
      await pending.promise;
    });
    expect(result.current.form.internalText).toBe('');
    expect(result.current.generatingSince).toBeNull();
  });

  it('保存に失敗したら赤いお知らせを出し、保存済みにはしない', async () => {
    const { result } = renderController(sessionFor('c1', 1));
    act(() => result.current.actions.setMemo('メモ'));
    saveDaily.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      result.current.save();
    });
    await waitFor(() => expect(toastStore.getState()).toMatchObject({ visible: true, isError: true }));
    expect(result.current.form.saved.daily.reportId).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });
});
