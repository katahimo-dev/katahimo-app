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
  return {
    ...original,
    customersApi: {
      ...original.customersApi,
      detail: vi.fn(),
      reportProfile: vi.fn(),
      saveReportProfile: vi.fn(),
    },
  };
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
    vi.mocked(customersApi.reportProfile).mockImplementation(() => new Promise(() => undefined));
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

  describe('日報AI(対象のお子様・PSI・家庭の★)', () => {
    const profile = (educationLevel: number | null, rowVersion: number | null) => ({
      profile: { customerId: 'c1', educationLevel, rowVersion, updatedAt: null, updatedByName: null },
    });
    const detailWith = (familyMembers: { id: string; name: string; dob: string | null }[]) =>
      ({
        customer: {
          id: 'c1',
          name: 'お客様c1',
          addressDetail: '',
          familyMembers: familyMembers.map((m) => ({ ...m, info: null, allergy: null })),
        },
      }) as never;
    const AI = {
      generationId: '00000000-0000-7000-8000-0000000000e1',
      usedKeywords: [{ code: 'K01', keyword: '見守りの語', known: true }],
      candidateCount: 3,
      escalationRequired: true,
      childAgeMonths: 14,
      educationLevel: 2,
      effectiveEducationLevel: null,
    };

    it('お子様が1人なら最初から選び、PSI・お客様・訪問日と一緒に AI に送り、保存で生成の記録を結び付ける', async () => {
      vi.mocked(customersApi.detail).mockResolvedValue(
        detailWith([{ id: '00000000-0000-7000-8000-00000000c001', name: 'はな', dob: '2025/07/10' }]),
      );
      vi.mocked(customersApi.reportProfile).mockResolvedValue(profile(null, null));
      const { result } = renderController(sessionFor('c1', 1));
      await waitFor(() =>
        expect(result.current.dailyAi.childId).toBe('00000000-0000-7000-8000-00000000c001'),
      );
      await waitFor(() => expect(result.current.dailyAi.educationLevel).toBeNull());
      act(() => {
        result.current.actions.setMemo('メモ');
        result.current.actions.setRating('risk', 1);
      });
      generateDaily.mockResolvedValueOnce({
        draft: { internal: '社内', customer: '保護者', warnings: ['管理者へ連絡してください'] },
        ai: AI,
      });
      await act(async () => {
        result.current.generate();
      });
      expect(generateDaily).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'c1',
          careRecipientId: '00000000-0000-7000-8000-00000000c001',
          riskRating: 1,
          reportDate: result.current.form.reportDate,
        }),
      );
      await waitFor(() => expect(result.current.dailyAi.info?.escalationRequired).toBe(true));
      saveDaily.mockResolvedValueOnce(savedReport('r1', 'c1'));
      await act(async () => {
        result.current.save();
      });
      expect(saveDaily).toHaveBeenCalledWith(
        expect.objectContaining({
          careRecipientId: '00000000-0000-7000-8000-00000000c001',
          aiGenerationId: AI.generationId,
          riskRating: 1,
        }),
      );
    });

    it('お子様が何人もいれば選ばない(選ばなければ送らない)。家庭の★は読んだ版と一緒に変える', async () => {
      vi.mocked(customersApi.detail).mockResolvedValue(
        detailWith([
          { id: '00000000-0000-7000-8000-00000000c001', name: 'はな', dob: null },
          { id: '00000000-0000-7000-8000-00000000c002', name: 'そら', dob: null },
        ]),
      );
      vi.mocked(customersApi.reportProfile).mockResolvedValue(profile(3, 2));
      vi.mocked(customersApi.saveReportProfile).mockResolvedValue(profile(5, 3));
      const { result } = renderController(sessionFor('c1', 1));
      await waitFor(() => expect(result.current.dailyAi.educationLevel).toBe(3));
      expect(result.current.dailyAi.childId).toBe('');
      await act(async () => {
        result.current.dailyAi.setEducationLevel(5);
      });
      expect(customersApi.saveReportProfile).toHaveBeenCalledWith('c1', { educationLevel: 5, rowVersion: 2 });
      await waitFor(() => expect(result.current.dailyAi.educationLevel).toBe(5));
      act(() => result.current.actions.setMemo('メモ'));
      generateDaily.mockResolvedValueOnce({ draft: { internal: 'i', customer: 'c', warnings: [] }, ai: AI });
      await act(async () => {
        result.current.generate();
      });
      expect(generateDaily).toHaveBeenCalledWith(
        expect.objectContaining({ careRecipientId: null, riskRating: null }),
      );
    });
  });
});
