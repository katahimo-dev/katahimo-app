import type { ReportAiImportResponse, ReportAiMastersResponse } from '@katahimo/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportAiApi } from '../../../api/admin';
import { ApiRequestError } from '../../../api/client';
import { createQueryClient } from '../../../app/queryClient';
import { createWrapper, TEST_USER } from '../../../test/providers';
import { showToast } from '../../../ui/toast';
import { ReportAiPanel } from './ReportAiPanel';
import { formOf, rowOf } from './reportAiModel';

vi.mock('../../../api/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/admin')>()),
  reportAiApi: {
    masters: vi.fn(),
    saveRow: vi.fn(),
    saveLevel: vi.fn(),
    archiveRow: vi.fn(),
    importXlsx: vi.fn(),
    downloadXlsx: vi.fn(),
    downloadUsageCsv: vi.fn(),
  },
}));
vi.mock('../../../ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui/toast')>()),
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const KEYWORD_ID = '00000000-0000-7000-8000-00000000a001';

const masters = (): ReportAiMastersResponse => ({
  keywords: [
    {
      id: KEYWORD_ID,
      rowVersion: 3,
      updatedAt: '2026-09-26T00:00:00.000Z',
      code: 'K01',
      category: '分類A',
      keyword: '語A',
      subConcept: null,
      ageLabel: '3〜6歳',
      ageFromMonths: 36,
      ageToMonths: 84,
      ageBandLabel: null,
      educationLevelMin: 4,
      educationLevelMax: 5,
      psiMin: 3,
      tone: null,
      parentExplanation: '説明A',
      phraseExamples: null,
      usageScene: null,
      ngExample: null,
      sortOrder: 0,
    },
  ],
  ageBands: [],
  educationLevels: [],
  psiLevels: [
    {
      id: '00000000-0000-7000-8000-00000000b005',
      rowVersion: 1,
      updatedAt: '2026-09-26T00:00:00.000Z',
      level: 5,
      label: '安心',
      criteria: '基準',
    },
  ],
  phrases: [],
  stanceRules: [],
});

const counts = { rows: 1, created: 1, updated: 0, unchanged: 0 };
const importResult = (overrides: Partial<ReportAiImportResponse> = {}): ReportAiImportResponse => ({
  dryRun: true,
  applied: false,
  counts: {
    keywords: counts,
    ageBands: counts,
    educationLevels: counts,
    psiLevels: counts,
    phrases: counts,
    stanceRules: counts,
  },
  errors: [],
  warnings: [],
  ...overrides,
});

function renderPanel() {
  const Wrapper = createWrapper({ user: { ...TEST_USER, role: 'admin' } });
  return render(
    <Wrapper>
      <ReportAiPanel />
    </Wrapper>,
  );
}

describe('日報AIの調整', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reportAiApi.masters).mockResolvedValue(masters());
  });

  it('入力の形と API の形を行き来する(数・ID の並び・空は null)', () => {
    const values = formOf('ageBands', null);
    expect(values).toMatchObject({ ageFromMonths: '0', ageToMonths: '12', keywordCodes: '' });
    expect(rowOf('ageBands', { ...values, label: '1歳', keywordCodes: 'K11 K12、K24' })).toEqual({
      errors: null,
      row: {
        label: '1歳',
        ageFromMonths: 0,
        ageToMonths: 12,
        behaviorWords: null,
        developmentTopics: null,
        keywordCodes: ['K11', 'K12', 'K24'],
        sceneExamples: null,
        sortOrder: 0,
      },
    });
    expect(rowOf('ageBands', { ...values, label: '', ageToMonths: 'x' }).errors).toEqual({
      label: '年齢帯を入れてください',
      ageToMonths: '0以上の整数を入れてください',
    });
  });

  it('キーワードを直すと、読んだときの版と一緒に送る(他の管理者が先に直していれば理由を出す)', async () => {
    vi.mocked(reportAiApi.saveRow)
      .mockRejectedValueOnce(
        new ApiRequestError(409, {
          code: 'conflict',
          message: '他の人が先に保存しました。読み込み直してください',
        }),
      )
      .mockResolvedValueOnce({ id: KEYWORD_ID, rowVersion: 4, updatedAt: '2026-09-26T01:00:00.000Z' });
    renderPanel();
    const list = await screen.findByRole('list', { name: 'キーワード' });
    fireEvent.click(within(list).getByRole('button', { name: /K01 語A/ }));
    const dialog = await screen.findByRole('dialog', { name: 'キーワードを直す' });
    fireEvent.change(within(dialog).getByLabelText(/^キーワード/), { target: { value: '語B' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存する' }));
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      '他の人が先に保存しました。読み込み直してください',
    );
    expect(reportAiApi.saveRow).toHaveBeenCalledWith(
      'keywords',
      KEYWORD_ID,
      expect.objectContaining({
        rowVersion: 3,
        row: expect.objectContaining({ code: 'K01', keyword: '語B' }),
      }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('保存しました'));
  });

  it('PSI は 5〜1 の段階を並べ、無い段階は作る', async () => {
    vi.mocked(reportAiApi.saveLevel).mockResolvedValue({
      id: 'x',
      rowVersion: 1,
      updatedAt: '2026-09-26T00:00:00Z',
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('tab', { name: 'PSI' }));
    const list = await screen.findByRole('list', { name: 'PSI' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent?.slice(0, 5)),
    ).toEqual(['PSI 5', 'PSI 4', 'PSI 3', 'PSI 2', 'PSI 1']);
    fireEvent.click(within(list).getByRole('button', { name: /PSI 1/ }));
    const dialog = await screen.findByRole('dialog', { name: 'PSI 1' });
    fireEvent.change(within(dialog).getByLabelText(/^定義/), { target: { value: '危険' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存する' }));
    await waitFor(() =>
      expect(reportAiApi.saveLevel).toHaveBeenCalledWith('psi-levels', 1, {
        row: { label: '危険', criteria: null, level: 1 },
      }),
    );
  });

  it('xlsx を選ぶとまず確かめ、誤りがあれば反映できない。誤りが無ければ反映する', async () => {
    vi.mocked(reportAiApi.importXlsx)
      .mockResolvedValueOnce(
        importResult({ errors: [{ sheet: '01_マスター表', row: 5, message: 'IDを入力してください' }] }),
      )
      .mockResolvedValueOnce(importResult())
      .mockResolvedValueOnce(importResult({ dryRun: false, applied: true }));
    renderPanel();
    fireEvent.click(await screen.findByRole('tab', { name: '取込・書き出し' }));
    const input = await screen.findByLabelText('ファイル(.xlsx)');
    const file = new File([new Uint8Array([1, 2, 3])], 'master.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('01_マスター表 5行目: IDを入力してください')).toBeTruthy();
    expect(screen.getByRole('button', { name: '反映する' })).toHaveProperty('disabled', true);
    expect(reportAiApi.importXlsx).toHaveBeenLastCalledWith({
      fileBase64: 'AQID',
      fileName: 'master.xlsx',
      dryRun: true,
    });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '反映する' })).toHaveProperty('disabled', false),
    );
    fireEvent.click(screen.getByRole('button', { name: '反映する' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('取り込みました'));
    expect(reportAiApi.importXlsx).toHaveBeenLastCalledWith({
      fileBase64: 'AQID',
      fileName: 'master.xlsx',
      dryRun: false,
    });
  });

  it('開き直すと(アプリの既定の staleTime の間でも)読み直し、画面の外で足された行を出す', async () => {
    const Wrapper = createWrapper({
      queryClient: createQueryClient(),
      user: { ...TEST_USER, role: 'admin' },
    });
    const first = render(
      <Wrapper>
        <ReportAiPanel />
      </Wrapper>,
    );
    await screen.findByRole('heading', { name: 'キーワード(1)' });
    first.unmount();

    const [keyword] = masters().keywords;
    if (!keyword) throw new Error('キーワードの行が無い');
    const added = { ...keyword, id: '00000000-0000-7000-8000-00000000a002', code: 'K02', keyword: '語B' };
    vi.mocked(reportAiApi.masters).mockResolvedValue({ ...masters(), keywords: [keyword, added] });
    render(
      <Wrapper>
        <ReportAiPanel />
      </Wrapper>,
    );
    await screen.findByRole('button', { name: /K02 語B/ });
    expect(reportAiApi.masters).toHaveBeenCalledTimes(2);
  });
});
