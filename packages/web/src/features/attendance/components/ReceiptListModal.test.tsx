import type { ReceiptListItem, ReceiptListResponse, SessionUser } from '@katahimo/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { receiptsApi } from '../../../api/receipts';
import { staffApi } from '../../../api/staff';
import { AdminTargetStaffProvider } from '../../../app/adminTargetStaff';
import { createWrapper, TEST_USER } from '../../../test/providers';
import { ReceiptListModal } from './ReceiptListModal';

vi.mock('../../../api/receipts', () => ({
  receiptsApi: {
    list: vi.fn(),
    imageUrl: vi.fn((id: string) => `/api/receipts/${id}/image`),
    csvUrl: vi.fn(() => '/api/receipts/csv?month=2026-09&allStaff=true'),
  },
}));
vi.mock('../../../api/staff', () => ({ staffApi: { listActive: vi.fn() } }));

const listApi = vi.mocked(receiptsApi.list);
const OTHER_ID = '00000000-0000-4000-8000-00000000b002';

function item(overrides: Partial<ReceiptListItem> = {}): ReceiptListItem {
  return {
    id: '00000000-0000-4000-8000-00000000c001',
    // 日本時間 9/10(木) 12:00
    receiptedAt: '2026-09-10T03:00:00.000Z',
    staffId: TEST_USER.staffId,
    staffName: TEST_USER.name,
    customerId: null,
    customerName: null,
    amountYen: 1200,
    storeName: 'コンビニ',
    handoffText: '駐車場代です',
    uploadBatchId: '00000000-0000-4000-8000-00000000d001',
    imageContentType: 'image/jpeg',
    imageByteSize: 1000,
    ...overrides,
  };
}

function page(overrides: Partial<ReceiptListResponse> = {}): ReceiptListResponse {
  return {
    receipts: [item()],
    nextCursor: null,
    yearMonth: '2026-09',
    staff: { id: TEST_USER.staffId, name: TEST_USER.name },
    summary: { count: 1, totalYen: 1200, noAmountCount: 0 },
    timeZone: 'Asia/Tokyo',
    ...overrides,
  };
}

function renderModal(user: SessionUser = TEST_USER) {
  const Wrapper = createWrapper({ user });
  return render(
    <Wrapper>
      <AdminTargetStaffProvider>
        <ReceiptListModal open initialMonth="2026-09" onClose={() => {}} />
      </AdminTargetStaffProvider>
    </Wrapper>,
  );
}

describe('領収書の一覧', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(staffApi.listActive).mockResolvedValue({
      staff: [
        { id: TEST_USER.staffId, name: TEST_USER.name },
        { id: OTHER_ID, name: '一般 花子' },
      ],
    });
  });

  it('一般スタッフは本人の月の一覧だけ(スタッフの選択・CSV なし)。押すと画像を大きく出す', async () => {
    listApi.mockResolvedValue(page());
    renderModal({ ...TEST_USER, role: 'staff' });
    expect(await screen.findByText('1件 合計 1,200円')).toBeTruthy();
    expect(listApi).toHaveBeenCalledWith({ month: '2026-09' }, undefined, expect.anything());
    expect(screen.queryByLabelText('表示するスタッフ')).toBeNull();
    expect(screen.queryByText('⬇ CSVで保存')).toBeNull();
    const list = screen.getByRole('list', { name: '領収書の一覧' });
    expect(within(list).getByText('9/10(木) 12:00')).toBeTruthy();
    expect(within(list).getByText('お客様の指定なし')).toBeTruthy();
    expect(within(list).getByText('📝 駐車場代です')).toBeTruthy();
    const thumbnail = within(list).getByRole('img') as HTMLImageElement;
    expect(thumbnail.getAttribute('src')).toBe(`/api/receipts/${item().id}/image`);
    expect(thumbnail.getAttribute('loading')).toBe('lazy');

    fireEvent.click(within(list).getByRole('button'));
    const viewer = await screen.findByRole('dialog', { name: /1,200円 コンビニ/ });
    expect(within(viewer).getByRole('img', { name: '領収書の画像' }).getAttribute('src')).toBe(
      `/api/receipts/${item().id}/image`,
    );
  });

  it('管理者は「全員」や他のスタッフを選べ、続きを読める。CSV で保存できる', async () => {
    listApi.mockImplementation(async (filters, cursor) =>
      filters.allStaff
        ? cursor
          ? page({
              staff: null,
              receipts: [item({ id: '00000000-0000-4000-8000-00000000c003', amountYen: 50 })],
            })
          : page({
              staff: null,
              nextCursor: 'next',
              receipts: [item({ staffId: OTHER_ID, staffName: '一般 花子', amountYen: null })],
              summary: { count: 2, totalYen: 50, noAmountCount: 1 },
            })
        : page(),
    );
    renderModal();
    await screen.findByText('1件 合計 1,200円');
    const select = screen.getByLabelText('表示するスタッフ') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByText('一般 花子')).toBeTruthy());
    fireEvent.change(select, { target: { value: 'all' } });
    expect(await screen.findByText('2件 合計 50円(うち金額なし1件)')).toBeTruthy();
    expect(listApi).toHaveBeenLastCalledWith(
      { month: '2026-09', allStaff: true },
      undefined,
      expect.anything(),
    );
    // 全員のときはスタッフ名も出す
    expect(screen.getByText('一般 花子 ／ お客様の指定なし')).toBeTruthy();
    expect(screen.getByText('金額なし')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }));
    expect(await screen.findByText('50円')).toBeTruthy();
    expect(screen.getByText('⬇ CSVで保存').getAttribute('href')).toBe(
      '/api/receipts/csv?month=2026-09&allStaff=true',
    );

    fireEvent.change(select, { target: { value: OTHER_ID } });
    await waitFor(() =>
      expect(listApi).toHaveBeenLastCalledWith(
        { month: '2026-09', staffId: OTHER_ID },
        undefined,
        expect.anything(),
      ),
    );
  });

  it('0件のときはお知らせ、読めなかったときは理由を出す', async () => {
    listApi.mockResolvedValueOnce(
      page({ receipts: [], summary: { count: 0, totalYen: 0, noAmountCount: 0 } }),
    );
    const { unmount } = renderModal({ ...TEST_USER, role: 'staff' });
    expect(await screen.findByText('この月の領収書はありません')).toBeTruthy();
    unmount();
    listApi.mockRejectedValueOnce(new Error('network'));
    renderModal({ ...TEST_USER, role: 'staff' });
    expect(await screen.findByText(/うまくいきませんでした/)).toBeTruthy();
  });
});
