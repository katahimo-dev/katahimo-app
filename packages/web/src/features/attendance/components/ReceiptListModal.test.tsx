import type { ReceiptListItem, ReceiptListResponse, SessionUser } from '@katahimo/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../api/client';
import { receiptsApi } from '../../../api/receipts';
import { staffApi } from '../../../api/staff';
import { AdminTargetStaffProvider } from '../../../app/adminTargetStaff';
import { saveBlobAsFile } from '../../../lib/saveFile';
import { createWrapper, TEST_USER } from '../../../test/providers';
import { showErrorToast, showToast } from '../../../ui/toast';
import { ReceiptListModal } from './ReceiptListModal';

vi.mock('../../../api/receipts', () => ({
  receiptsApi: {
    list: vi.fn(),
    imageUrl: vi.fn((id: string) => `/api/receipts/${id}/image`),
    downloadCsv: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('../../../lib/saveFile', () => ({ saveBlobAsFile: vi.fn() }));
vi.mock('../../../ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui/toast')>()),
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
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
    companyPaid: false,
    rowVersion: 1,
    cancellation: null,
    cancellable: false,
    ...overrides,
  };
}

function summary(overrides: Partial<ReceiptListResponse['summary']> = {}): ReceiptListResponse['summary'] {
  const base = {
    count: 0,
    totalYen: 0,
    companyPaidYen: 0,
    noAmountCount: 0,
    cancelledCount: 0,
    ...overrides,
  };
  return { ...base, customerBillableYen: base.totalYen - base.companyPaidYen };
}

function page(overrides: Partial<ReceiptListResponse> = {}): ReceiptListResponse {
  return {
    receipts: [item()],
    nextCursor: null,
    yearMonth: '2026-09',
    staff: { id: TEST_USER.staffId, name: TEST_USER.name },
    summary: summary({ count: 1, totalYen: 1200 }),
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
              summary: summary({ count: 2, totalYen: 50, noAmountCount: 1 }),
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
    // CSV は api.download で受けてから保存する(断られたら理由のお知らせ。ファイルにしない)
    const file = { blob: new Blob(['x']), filename: 'receipts_2026-09_all.csv' };
    vi.mocked(receiptsApi.downloadCsv).mockResolvedValueOnce(file);
    fireEvent.click(screen.getByRole('button', { name: '⬇ CSVで保存' }));
    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalledWith(file.blob, file.filename));
    expect(receiptsApi.downloadCsv).toHaveBeenLastCalledWith({ month: '2026-09', allStaff: true });
    expect(showToast).toHaveBeenCalledWith('CSVファイルを保存しました');
    vi.mocked(saveBlobAsFile).mockClear();
    const refused = new ApiRequestError(429, { code: 'rate_limited', message: '回数の上限です' });
    vi.mocked(receiptsApi.downloadCsv).mockRejectedValueOnce(refused);
    fireEvent.click(screen.getByRole('button', { name: '⬇ CSVで保存' }));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(refused));
    expect(saveBlobAsFile).not.toHaveBeenCalled();

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
    listApi.mockResolvedValueOnce(page({ receipts: [], summary: summary({ count: 0, totalYen: 0 }) }));
    const { unmount } = renderModal({ ...TEST_USER, role: 'staff' });
    expect(await screen.findByText('この月の領収書はありません')).toBeTruthy();
    unmount();
    listApi.mockRejectedValueOnce(new Error('network'));
    renderModal({ ...TEST_USER, role: 'staff' });
    expect(await screen.findByText(/うまくいきませんでした/)).toBeTruthy();
  });

  it('会社負担の印・合計の内訳を出す。取消済みは灰色で「取消」・取消した人と日時・理由を出し、「取消」は出さない', async () => {
    listApi.mockResolvedValue(
      page({
        receipts: [
          item({ id: '00000000-0000-4000-8000-00000000c010', storeName: '駐車場', companyPaid: true }),
          item({
            id: '00000000-0000-4000-8000-00000000c011',
            storeName: '間違い',
            amountYen: 9999,
            cancellation: {
              // 日本時間 9/11(金) 09:30
              cancelledAt: '2026-09-11T00:30:00.000Z',
              cancelledByName: '管理 花子',
              reason: '二重に撮った',
            },
          }),
        ],
        summary: summary({ count: 1, totalYen: 1200, companyPaidYen: 1200, cancelledCount: 1 }),
      }),
    );
    renderModal({ ...TEST_USER, role: 'staff' });
    expect(await screen.findByText('うち会社負担 1,200円 ／ お客様請求 0円')).toBeTruthy();
    expect(screen.getByText('取消 1件(合計に入れていません)')).toBeTruthy();
    const list = screen.getByRole('list', { name: '領収書の一覧' });
    const [paid, cancelled] = within(list).getAllByRole('listitem') as [HTMLElement, HTMLElement];
    expect(within(paid).getByText('会社負担')).toBeTruthy();
    expect(within(cancelled).getByText('取消')).toBeTruthy();
    expect(within(cancelled).getByText('取消 9/11(金) 09:30 管理 花子')).toBeTruthy();
    expect(within(cancelled).getByText('理由: 二重に撮った')).toBeTruthy();
    expect(cancelled.className).toContain('bg-gray-100');
    expect(within(cancelled).getByText('9,999円').className).toContain('line-through');
    // 取消せない行(cancellable: false)には「取消」のボタンを出さない
    expect(within(list).queryByRole('button', { name: /^取消\(/ })).toBeNull();
  });

  it('取消せる行は「取消」→理由(任意の1行)→「取消す」で取消し、一覧を読み直して端末の送った印も消す', async () => {
    const target = item({ cancellable: true, rowVersion: 3, customerId: null });
    listApi.mockResolvedValue(page({ receipts: [target] }));
    vi.mocked(receiptsApi.cancel).mockResolvedValue({
      receipt: { ...target, cancellable: false, rowVersion: 4 },
    });
    // この端末から前に送った印(取消した後は送り直せるように消す)
    const bucket = `GAS_RECEIPT_KEYS_V1_${TEST_USER.name}`;
    localStorage.setItem(bucket, JSON.stringify({ '2026/09/10 12:00||||1200||コンビニ': Date.now() }));
    renderModal({ ...TEST_USER, role: 'staff' });
    fireEvent.click(await screen.findByRole('button', { name: '取消(9/10(木) 12:00 1,200円)' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'この領収書を取消しますか？' });
    const reason = within(dialog).getByLabelText('取消の理由（あれば）') as HTMLInputElement;
    expect(reason.maxLength).toBe(100);
    fireEvent.change(reason, { target: { value: '金額を間違えた' } });
    const calls = listApi.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: '取消す' }));
    await waitFor(() =>
      expect(receiptsApi.cancel).toHaveBeenCalledWith(target.id, { reason: '金額を間違えた', rowVersion: 3 }),
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('領収書を取消しました'));
    await waitFor(() => expect(listApi.mock.calls.length).toBeGreaterThan(calls));
    expect(JSON.parse(localStorage.getItem(bucket) ?? '{}')).toEqual({});
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it.each([
    ['409', new ApiRequestError(409, { code: 'conflict', message: '先に更新されました' })],
    ['400 locked', new ApiRequestError(400, { code: 'locked', message: '取消せる期間を過ぎました' })],
  ])('取消を断られたら理由を出す(%s は一覧と今月のまとめを読み直して閉じる)', async (_, refused) => {
    listApi.mockResolvedValue(page({ receipts: [item({ cancellable: true })] }));
    vi.mocked(receiptsApi.cancel).mockRejectedValueOnce(refused);
    // 今月のまとめの端末のキャッシュ(読み直すために消す)
    localStorage.setItem('attendanceMonthly_x_2026-09', '{}');
    renderModal({ ...TEST_USER, role: 'staff' });
    fireEvent.click(await screen.findByRole('button', { name: /^取消\(/ }));
    const dialog = await screen.findByRole('alertdialog');
    const calls = listApi.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: '取消す' }));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(refused));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(listApi.mock.calls.length).toBeGreaterThan(calls));
    expect(localStorage.getItem('attendanceMonthly_x_2026-09')).toBeNull();
  });

  it('二重に押しても取消は1回だけ送る', async () => {
    const target = item({ cancellable: true });
    listApi.mockResolvedValue(page({ receipts: [target] }));
    let resolve: (value: { receipt: ReceiptListItem }) => void = () => {};
    vi.mocked(receiptsApi.cancel).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderModal({ ...TEST_USER, role: 'staff' });
    fireEvent.click(await screen.findByRole('button', { name: /^取消\(/ }));
    const dialog = await screen.findByRole('alertdialog');
    const reason = within(dialog).getByLabelText('取消の理由（あれば）');
    const button = within(dialog).getByRole('button', { name: '取消す' });
    // 同じ描画の中で Enter と「取消す」を続けて押す(間で描画し直さない)
    act(() => {
      fireEvent.keyDown(reason, { key: 'Enter' });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    resolve({ receipt: { ...target, cancellable: false, rowVersion: 2 } });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('領収書を取消しました'));
    expect(receiptsApi.cancel).toHaveBeenCalledTimes(1);
  });

  it('他のスタッフの領収書を取消しても、この端末の送った印は消さない(本人の分だけ消す)', async () => {
    const target = item({ cancellable: true, staffId: OTHER_ID, staffName: '一般 花子' });
    listApi.mockResolvedValue(page({ receipts: [target], staff: { id: OTHER_ID, name: '一般 花子' } }));
    vi.mocked(receiptsApi.cancel).mockResolvedValue({ receipt: { ...target, cancellable: false } });
    const sent = { '2026/09/10 12:00||||1200||コンビニ': Date.now() };
    const mine = `GAS_RECEIPT_KEYS_V1_${TEST_USER.name}`;
    const theirs = 'GAS_RECEIPT_KEYS_V1_一般 花子';
    localStorage.setItem(mine, JSON.stringify(sent));
    localStorage.setItem(theirs, JSON.stringify(sent));
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: /^取消\(/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消す' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('領収書を取消しました'));
    expect(JSON.parse(localStorage.getItem(mine) ?? '{}')).toEqual(sent);
    expect(JSON.parse(localStorage.getItem(theirs) ?? '{}')).toEqual(sent);
  });
});
