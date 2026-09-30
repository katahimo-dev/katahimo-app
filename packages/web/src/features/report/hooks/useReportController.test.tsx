import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customersApi } from '../../../api/customers';
import { queryKeys } from '../../../api/queryKeys';
import { reportsApi } from '../../../api/reports';
import { STORAGE_KEYS, userStorageKey } from '../../../lib/storage';
import { createTestQueryClient, createWrapper, deferred, TEST_USER } from '../../../test/providers';
import { toastStore } from '../../../ui/toast/toastStore';
import type { ReportSession } from '../types';
import { useReportController } from './useReportController';

vi.mock('../../../api/reports', () => ({
  reportsApi: {
    generateDaily: vi.fn(),
    generateModels: vi.fn(),
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

/** AIに書いてもらう(モデルの順番を読んでから問い合わせるので、待っている答えが全部返るまで待つ) */
async function generateNow(result: { current: ReturnType<typeof useReportController> }) {
  await act(async () => {
    result.current.generate();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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
    vi.mocked(reportsApi.generateModels).mockResolvedValue({ models: [] });
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

  it('保存できたら報告一覧(管理タブ)を読み直させる。失敗したら読み直させない', async () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useReportController(sessionFor('c1', 1)), {
      wrapper: createWrapper({ queryClient }),
    });
    act(() => result.current.actions.setMemo('公園で外遊び'));

    saveDaily.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      result.current.save();
    });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.reports.all });

    saveDaily.mockResolvedValueOnce(savedReport('r1', 'c1'));
    await act(async () => {
      result.current.save();
    });
    await waitFor(() => expect(result.current.form.saved.daily.reportId).toBe('r1'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.reports.all });
  });

  it('戻した書きかけは、お知らせの「破棄する」で消して空の入力に戻せる(確かめて断れば残す)', async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        customerId: 'c1',
        customerName: '明智 光秀',
        mode: 'daily',
        inputText: '間違えたメモ',
      }),
    );
    const { result } = renderController(sessionFor('c2', 1));
    expect(result.current.form.memo).toBe('間違えたメモ');
    const toast = toastStore.getState();
    expect(toast.isError).toBe(true);
    expect(toast.message).toContain('明智 光秀様の日報が保存されていません');
    expect(toast.action?.label).toBe('破棄する');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    act(() => toast.action?.run());
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(result.current.form.memo).toBe('間違えたメモ');
    // 断ったら同じお知らせを出し直す
    expect(toastStore.getState().action?.label).toBe('破棄する');

    confirmSpy.mockReturnValueOnce(true);
    act(() => toastStore.getState().action?.run());
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(result.current.form.memo).toBe('');
    expect(toastStore.getState().message).toBe('書きかけを破棄しました');
    confirmSpy.mockRestore();
  });

  it('保存を始めたら「破棄する」のお知らせを消し、保存の途中では破棄しない', async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ customerId: 'c1', customerName: '明智 光秀', mode: 'daily', inputText: 'メモ' }),
    );
    const { result } = renderController(sessionFor('c1', 1));
    const discard = toastStore.getState().action;
    expect(discard?.label).toBe('破棄する');

    const pending = deferred<SaveResult>();
    saveDaily.mockReturnValueOnce(pending.promise);
    act(() => result.current.save());
    expect(toastStore.getState().visible).toBe(false);

    const confirmSpy = vi.spyOn(window, 'confirm');
    act(() => discard?.run());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(result.current.form.memo).toBe('メモ');
    expect(toastStore.getState().message).toBe('保存・AIの生成が終わってから破棄してください');
    confirmSpy.mockRestore();
    await act(async () => {
      pending.resolve(savedReport('r1', 'c1'));
      await pending.promise;
    });
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
    await waitFor(() => expect(generateDaily).toHaveBeenCalled());

    rerender({ session: sessionFor('c2', 2) });
    // 開き直したら、待っていた問い合わせは切る
    expect(generateDaily.mock.calls[0]?.[1]?.aborted).toBe(true);
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
      usedKeywords: [{ code: 'K01', keyword: '見守りの語', status: 'used' as const }],
      candidateCount: 3,
      escalationRequired: true,
      childAgeMonths: 14,
      educationLevel: 2,
      effectiveEducationLevel: null,
      model: 'gemini-2.5-flash',
      retryable: false,
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
      await generateNow(result);
      expect(generateDaily).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'c1',
          careRecipientId: '00000000-0000-7000-8000-00000000c001',
          riskRating: 1,
          reportDate: result.current.form.reportDate,
        }),
        expect.any(AbortSignal),
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
      await generateNow(result);
      expect(generateDaily).toHaveBeenCalledWith(
        expect.objectContaining({ careRecipientId: null, riskRating: null }),
        expect.any(AbortSignal),
      );
    });
  });

  describe('AIのモデルの切り替え・止める・手で書く', () => {
    const AI = {
      generationId: null,
      usedKeywords: [],
      candidateCount: 0,
      escalationRequired: false,
      childAgeMonths: null,
      educationLevel: 2,
      effectiveEducationLevel: 2,
      retryable: false,
    };
    const apiError = (model: string, retryable: boolean) => ({
      draft: { warnings: ['API Error'], internal: `${model} は混み合っています`, customer: '' },
      ai: { ...AI, model, retryable },
    });
    const ok = (model: string) => ({
      draft: { warnings: [], internal: `${model} の社内文`, customer: '保護者へ' },
      ai: { ...AI, model },
    });

    async function openWithMemo() {
      const rendered = renderController(sessionFor('c1', 1));
      act(() => rendered.result.current.actions.setMemo('公園で外遊び'));
      return rendered;
    }

    it('API エラーなら次のモデル(Flash → Flash-Lite の順)を指定して試し直し、書けたモデルの結果を入れる', async () => {
      vi.mocked(reportsApi.generateModels).mockResolvedValue({
        models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'],
      });
      generateDaily
        .mockResolvedValueOnce(apiError('gemini-2.5-flash', true))
        .mockResolvedValueOnce(apiError('gemini-2.0-flash', true))
        .mockResolvedValueOnce(ok('gemini-2.5-flash-lite'));
      const { result } = await openWithMemo();
      await generateNow(result);
      expect(generateDaily.mock.calls.map(([body]) => body.model)).toEqual([
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite',
      ]);
      expect(result.current.form.internalText).toBe('gemini-2.5-flash-lite の社内文');
      expect(result.current.form.aiFailure).toBeNull();
      expect(result.current.dailyAi.info?.model).toBe('gemini-2.5-flash-lite');
      expect(result.current.generatingSince).toBeNull();
    });

    it('全部のモデルで書けなければ、試したモデルと理由を出して結果欄を開き、手で書いて保存できる', async () => {
      vi.mocked(reportsApi.generateModels).mockResolvedValue({
        models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      });
      generateDaily
        .mockResolvedValueOnce(apiError('gemini-2.5-flash', true))
        .mockResolvedValueOnce(apiError('gemini-2.5-flash-lite', true));
      const { result } = await openWithMemo();
      await generateNow(result);
      expect(generateDaily).toHaveBeenCalledTimes(2);
      expect(result.current.form.dailyResultShown).toBe(true);
      expect(result.current.form.aiFailure).toContain('gemini-2.5-flash → gemini-2.5-flash-lite');
      expect(result.current.form.aiFailure).toContain('gemini-2.5-flash-lite は混み合っています');
      expect(result.current.dailyAi.info).toBeNull();

      act(() => {
        result.current.actions.setDailyText('internalText', '手で書いた社内文');
        result.current.actions.setDailyText('customerText', '手で書いた保護者向け');
      });
      saveDaily.mockResolvedValueOnce(savedReport('r1', 'c1'));
      await act(async () => {
        result.current.save();
      });
      expect(saveDaily).toHaveBeenCalledWith(
        expect.objectContaining({ internalText: '手で書いた社内文', aiGenerationId: undefined }),
      );
    });

    it('試し直しても変わらない失敗(API キーの誤り)は次のモデルを試さない', async () => {
      vi.mocked(reportsApi.generateModels).mockResolvedValue({
        models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
      });
      generateDaily.mockResolvedValueOnce(apiError('gemini-2.5-flash', false));
      const { result } = await openWithMemo();
      await generateNow(result);
      expect(generateDaily).toHaveBeenCalledTimes(1);
      expect(result.current.form.dailyResultShown).toBe(true);
      expect(result.current.form.aiFailure).toContain('gemini-2.5-flash');
    });

    it('モデルの順番が読めなければ、モデルを指定せずに1回だけ試す', async () => {
      vi.mocked(reportsApi.generateModels).mockRejectedValue(new Error('network'));
      generateDaily.mockResolvedValueOnce(ok('gemini-2.5-flash'));
      const { result } = await openWithMemo();
      await generateNow(result);
      expect(generateDaily).toHaveBeenCalledTimes(1);
      expect(generateDaily.mock.calls[0]?.[0].model).toBeUndefined();
      expect(result.current.form.internalText).toBe('gemini-2.5-flash の社内文');
    });

    it('いま試しているモデルを見せ、⏹ 止めると問い合わせを切って手で書けるようにする', async () => {
      vi.mocked(reportsApi.generateModels).mockResolvedValue({
        models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
      });
      const pending = deferred<Awaited<ReturnType<typeof reportsApi.generateDaily>>>();
      generateDaily
        .mockResolvedValueOnce(apiError('gemini-2.5-flash', true))
        .mockReturnValueOnce(pending.promise);
      const { result } = await openWithMemo();
      act(() => result.current.generate());
      await waitFor(() => expect(generateDaily).toHaveBeenCalledTimes(2));
      expect(result.current.aiProgress).toEqual({
        model: 'gemini-2.0-flash',
        attempt: 2,
        total: 2,
        failed: ['gemini-2.5-flash'],
        notice: 'gemini-2.5-flash で書けなかったので、gemini-2.0-flash で試しています',
      });
      // 切り替えの知らせはトーストにしない(「⏹ 止めて手で書く」に重ならないように)
      expect(toastStore.getState().visible).toBe(false);

      act(() => result.current.stopGenerating());
      expect(generateDaily.mock.calls[1]?.[1]?.aborted).toBe(true);
      await waitFor(() => expect(result.current.generatingSince).toBeNull());
      expect(result.current.aiProgress).toBeNull();
      expect(result.current.form.dailyResultShown).toBe(true);
      expect(result.current.form.aiFailure).toContain('AIを止めました');
      // 止めたあとに届いた答えは入れない
      await act(async () => {
        pending.resolve(ok('gemini-2.0-flash'));
        await pending.promise;
      });
      expect(result.current.form.internalText).toBe('');
    });
  });

  describe('事故報告の AI 生成(日報と同じモデルの切り替え)', () => {
    const generateAccident = vi.mocked(reportsApi.generateAccident);
    const DRAFT = {
      occurrenceTime: '10:00',
      location: '公園',
      accidentContent: '転んだ',
      situation: '走っていた',
      immediateResponse: '冷やした',
      parentCorrespondence: '伝えた',
      diagnosisTreatment: 'なし',
      prevention: '見守る',
    };
    const failed = (model: string, retryable: boolean) => ({
      draft: { error: `${model} は混み合っています` },
      model,
      retryable,
    });

    async function openAccidentWithMemo() {
      const rendered = renderController(sessionFor('c1', 1));
      act(() => {
        rendered.result.current.actions.switchMode('accident');
        rendered.result.current.actions.setMemo('公園で転んだ');
      });
      return rendered;
    }

    it('失敗なら次のモデルを指定して試し直し、書けたモデルの結果を入れる', async () => {
      vi.mocked(reportsApi.generateModels).mockResolvedValue({
        models: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'],
      });
      generateAccident
        .mockResolvedValueOnce(failed('gemini-flash-latest', true))
        .mockResolvedValueOnce({ draft: DRAFT, model: 'gemini-2.5-flash', retryable: false });
      const { result } = await openAccidentWithMemo();
      await generateNow(result);
      expect(generateAccident.mock.calls.map(([body]) => body.model)).toEqual([
        'gemini-flash-latest',
        'gemini-2.5-flash',
      ]);
      expect(result.current.form.accident.location).toBe('公園');
      expect(result.current.form.accidentResultShown).toBe(true);
      expect(result.current.form.aiFailure).toBeNull();
      expect(toastStore.getState().message).toBe('gemini-2.5-flash で書きました');
      expect(result.current.generatingSince).toBeNull();
    });

    it('試し直しても変わらない失敗・全部のモデルで書けなければ、理由を出して手で書けるようにする', async () => {
      vi.mocked(reportsApi.generateModels).mockResolvedValue({
        models: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'],
      });
      generateAccident
        .mockResolvedValueOnce(failed('gemini-flash-latest', true))
        .mockResolvedValueOnce(failed('gemini-2.5-flash', false));
      const { result } = await openAccidentWithMemo();
      await generateNow(result);
      expect(generateAccident).toHaveBeenCalledTimes(2);
      expect(result.current.form.accidentResultShown).toBe(true);
      expect(result.current.form.aiFailure).toContain('gemini-flash-latest → gemini-2.5-flash');
      expect(result.current.form.aiFailure).toContain('gemini-2.5-flash は混み合っています');
    });

    it('いま試しているモデルを見せ、⏹ 止めると問い合わせを切って手で書けるようにする', async () => {
      vi.mocked(reportsApi.generateModels).mockResolvedValue({
        models: ['gemini-flash-latest', 'gemini-2.5-flash'],
      });
      const pending = deferred<Awaited<ReturnType<typeof reportsApi.generateAccident>>>();
      generateAccident
        .mockResolvedValueOnce(failed('gemini-flash-latest', true))
        .mockReturnValueOnce(pending.promise);
      const { result } = await openAccidentWithMemo();
      act(() => result.current.generate());
      await waitFor(() => expect(generateAccident).toHaveBeenCalledTimes(2));
      expect(result.current.aiProgress).toEqual({
        model: 'gemini-2.5-flash',
        attempt: 2,
        total: 2,
        failed: ['gemini-flash-latest'],
        notice: 'gemini-flash-latest で書けなかったので、gemini-2.5-flash で試しています',
      });
      act(() => result.current.stopGenerating());
      expect(generateAccident.mock.calls[1]?.[1]?.aborted).toBe(true);
      await waitFor(() => expect(result.current.generatingSince).toBeNull());
      expect(result.current.form.accidentResultShown).toBe(true);
      expect(result.current.form.aiFailure).toContain('AIを止めました');
      await act(async () => {
        pending.resolve({ draft: DRAFT, model: 'gemini-2.5-flash', retryable: false });
        await pending.promise;
      });
      expect(result.current.form.accident.location).toBe('');
    });
  });
});
