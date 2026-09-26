import type { ReportDetailResponse, ReportListItem, ReportListResponse } from '@katahimo/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../api/client';
import { customersApi } from '../../../api/customers';
import { reportsApi } from '../../../api/reports';
import { staffApi } from '../../../api/staff';
import { saveBlobAsFile } from '../../../lib/saveFile';
import { createWrapper, TEST_USER } from '../../../test/providers';
import { showErrorToast, showToast } from '../../../ui/toast';
import { AdminTab } from '../AdminTab';
import { ReportListPanel } from './ReportListPanel';
import { csvSheetsFor } from './reportFormat';

vi.mock('../../../api/reports', () => ({
  reportsApi: {
    list: vi.fn(),
    detail: vi.fn(),
    downloadCsv: vi.fn(),
  },
}));
vi.mock('../../../lib/saveFile', () => ({ saveBlobAsFile: vi.fn() }));
vi.mock('../../../ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui/toast')>()),
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));
vi.mock('../../../api/staff', () => ({ staffApi: { listActive: vi.fn() } }));
vi.mock('../../../api/customers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/customers')>()),
  customersApi: { list: vi.fn(), detail: vi.fn(), history: vi.fn() },
}));

const listApi = vi.mocked(reportsApi.list);
const detailApi = vi.mocked(reportsApi.detail);

const HANAKO = '00000000-0000-4000-8000-00000000b001';
const CUSTOMER = '00000000-0000-4000-8000-00000000c001';

function item(overrides: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: '00000000-0000-4000-8000-00000000d001',
    kind: 'daily_report',
    occurredAt: '2026-09-20T00:00:00.000Z',
    date: '2026-09-20',
    time: '09:00〜12:00',
    staffId: HANAKO,
    staffName: '一般 花子',
    customerId: CUSTOMER,
    customerName: '佐藤 はな',
    excerpt: '公園で遊びました',
    riskRating: 2,
    esRating: 4,
    updatedAt: '2026-09-20T05:00:00.000Z',
    ...overrides,
  };
}

function page(reports: ReportListItem[], nextCursor: string | null = null): ReportListResponse {
  return { reports, nextCursor, range: { from: '2026-08-27', to: '2026-09-26' }, timeZone: 'Asia/Tokyo' };
}

const detail: ReportDetailResponse = {
  timeZone: 'Asia/Tokyo',
  report: {
    ...item(),
    kind: 'daily_report',
    rowVersion: 2,
    revisionCount: 1,
    content: {
      startTime: '09:00',
      endTime: '12:00',
      inputText: 'こうえん',
      internalText: '公園で遊びました',
      customerText: '元気でした',
    },
  },
};

function renderPanel(role: 'admin' | 'coordinator' = 'coordinator', ui = <ReportListPanel />) {
  const Wrapper = createWrapper({ user: { ...TEST_USER, role } });
  return render(<Wrapper>{ui}</Wrapper>);
}

describe('報告一覧', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(staffApi.listActive).mockResolvedValue({ staff: [{ id: HANAKO, name: '一般 花子' }] });
    vi.mocked(customersApi.list).mockResolvedValue({
      customers: [{ id: CUSTOMER, name: '佐藤 はな', phone: null, city: null }],
      cities: [],
    });
  });

  it('全員分を新しい順に出し、「もっと見る」で続きを読む', async () => {
    listApi
      .mockResolvedValueOnce(page([item()], 'next-1'))
      .mockResolvedValueOnce(
        page([item({ id: '00000000-0000-4000-8000-00000000d002', kind: 'near_miss', excerpt: '転びそう' })]),
      );
    renderPanel();
    const list = await screen.findByRole('list', { name: '報告一覧' });
    expect(within(list).getByText('佐藤 はな')).toBeTruthy();
    expect(within(list).getByText('公園で遊びました')).toBeTruthy();
    // PSI 2 以下(管理者に知らせた日報)には印を付ける
    expect(within(list).getByText('⚠ PSI 2')).toBeTruthy();
    expect(screen.getByText('2026-08-27 〜 2026-09-26(新しい順)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }));
    expect(await within(list).findByText('ヒヤリハット')).toBeTruthy();
    expect(listApi).toHaveBeenLastCalledWith(expect.any(Object), 'next-1', expect.anything());
    expect(screen.queryByRole('button', { name: 'もっと見る' })).toBeNull();
  });

  it('条件を決めて「絞り込む」で読み直し、CSV は種類に合う形だけを出す', async () => {
    listApi.mockResolvedValue(page([item()]));
    renderPanel();
    await screen.findByRole('list', { name: '報告一覧' });
    expect(screen.getByRole('button', { name: '⬇ 日報のCSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '⬇ 事故報告・ヒヤリハットのCSV' })).toBeTruthy();

    await screen.findByRole('option', { name: '一般 花子' });
    await screen.findByRole('option', { name: '佐藤 はな' });
    fireEvent.change(screen.getByLabelText('種類'), { target: { value: 'accident' } });
    fireEvent.change(screen.getByLabelText('書いたスタッフ'), { target: { value: HANAKO } });
    fireEvent.change(screen.getByLabelText('お客様'), { target: { value: CUSTOMER } });
    fireEvent.click(screen.getByRole('button', { name: '絞り込む' }));
    await waitFor(() =>
      expect(listApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'accident', staffId: HANAKO, customerId: CUSTOMER }),
        undefined,
        expect.anything(),
      ),
    );
    expect(screen.queryByRole('button', { name: '⬇ 日報のCSV' })).toBeNull();
    // CSV は api.download で受けてから保存する(断られたら理由のお知らせ。ファイルにしない)
    const file = { blob: new Blob(['x']), filename: 'reports-accident.csv' };
    vi.mocked(reportsApi.downloadCsv).mockResolvedValueOnce(file);
    fireEvent.click(screen.getByRole('button', { name: '⬇ 事故報告・ヒヤリハットのCSV' }));
    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalledWith(file.blob, file.filename));
    expect(vi.mocked(reportsApi.downloadCsv)).toHaveBeenLastCalledWith(
      'accident',
      expect.objectContaining({ kind: 'accident' }),
    );
    expect(showToast).toHaveBeenCalledWith('CSVファイルを保存しました');

    vi.mocked(saveBlobAsFile).mockClear();
    const refused = new ApiRequestError(403, { code: 'forbidden', message: '権限がありません' });
    vi.mocked(reportsApi.downloadCsv).mockRejectedValueOnce(refused);
    fireEvent.click(screen.getByRole('button', { name: '⬇ 事故報告・ヒヤリハットのCSV' }));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(refused));
    expect(saveBlobAsFile).not.toHaveBeenCalled();
  });

  it('条件の誤りはサーバーの理由を出し、CSV は押せない', async () => {
    listApi.mockRejectedValue(
      new ApiRequestError(400, { code: 'validation_failed', message: '期間は366日以内で指定してください' }),
    );
    renderPanel();
    expect(await screen.findByText('期間は366日以内で指定してください')).toBeTruthy();
    expect((screen.getByRole('button', { name: '⬇ 日報のCSV' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('押すと中身を読むだけのダイアログで開く', async () => {
    listApi.mockResolvedValue(page([item()]));
    detailApi.mockResolvedValue(detail);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /佐藤 はな/ }));
    const dialog = await screen.findByRole('dialog', { name: '報告の中身' });
    expect(await within(dialog).findByText('元気でした')).toBeTruthy();
    expect(within(dialog).getByText('書いた人: 一般 花子')).toBeTruthy();
    expect(within(dialog).getByText(/1回 直しています/)).toBeTruthy();
    expect(within(dialog).getByText('PSI: 2')).toBeTruthy();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(detailApi).toHaveBeenCalledWith(detail.report.id, expect.anything());
    fireEvent.click(within(dialog).getAllByRole('button', { name: /閉じる/ })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('コーディネーターの管理タブには「報告一覧」だけを出す', async () => {
    listApi.mockResolvedValue(page([]));
    renderPanel('coordinator', <AdminTab />);
    expect(await screen.findByText('この条件の報告はありません')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('👤 スタッフ')).toBeNull();
  });
});

describe('CSV の形', () => {
  it('種類の絞り込みに合う形だけ', () => {
    expect(csvSheetsFor(undefined)).toEqual(['daily', 'accident']);
    expect(csvSheetsFor('daily_report')).toEqual(['daily']);
    expect(csvSheetsFor('near_miss')).toEqual(['accident']);
  });
});
