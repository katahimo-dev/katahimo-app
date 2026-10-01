import type { CustomerCsvImportResponse } from '@katahimo/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { customersApi } from '../../api/customers';
import { queryKeys } from '../../api/queryKeys';
import { createTestQueryClient, createWrapper, deferred } from '../../test/providers';
import { showErrorToast } from '../../ui/toast';
import { CustomerCsvImportButton } from './CustomerCsvImportButton';
import { customerCsvImportMessage } from './customerCsvImportMessage';

vi.mock('../../api/customers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/customers')>();
  return { ...original, customersApi: { ...original.customersApi, importLatestCsv: vi.fn() } };
});
vi.mock('../../ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/toast')>()),
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const importLatestCsv = vi.mocked(customersApi.importLatestCsv);

const response = (patch: Partial<CustomerCsvImportResponse>): CustomerCsvImportResponse => ({
  status: 'imported',
  message: '顧客CSVを取り込みました: Kokyaku_202610011000.csv',
  fileName: 'Kokyaku_202610011000.csv',
  version: '202610011000',
  stats: { created: 1, updated: 3, archived: 0, existingActiveCount: 50, incomingCount: 51, missingRatio: 0 },
  dataVersion: '8',
  ...patch,
});

beforeEach(() => vi.clearAllMocks());

describe('customerCsvImportMessage', () => {
  it('取り込んだら新しいお客様の件数を先に、外れたお客様は居るときだけ出す', () => {
    expect(customerCsvImportMessage(response({}))).toBe('取り込みました(新しいお客様 1件・変更 3件)');
    expect(
      customerCsvImportMessage(
        response({
          stats: {
            created: 0,
            updated: 0,
            archived: 2,
            existingActiveCount: 50,
            incomingCount: 48,
            missingRatio: 0.04,
          },
        }),
      ),
    ).toBe('取り込みました(新しいお客様 0件・変更 0件・一覧から外れた 2件)');
    expect(customerCsvImportMessage(response({ status: 'up_to_date', stats: null }))).toBe(
      '最新のお客様の情報は取り込み済みです',
    );
    expect(
      customerCsvImportMessage(
        response({ status: 'not_configured', message: '顧客CSVの取込元が設定されていません。' }),
      ),
    ).toBe('顧客CSVの取込元が設定されていません。');
  });
});

describe('CustomerCsvImportButton', () => {
  it('取り込んでいる間は押せず、取り込めたら件数を出して顧客データの版数を新しくする', async () => {
    const pending = deferred<CustomerCsvImportResponse>();
    importLatestCsv.mockReturnValue(pending.promise);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.dataVersion, { dataVersion: '7' });
    render(<CustomerCsvImportButton />, { wrapper: createWrapper({ queryClient }) });

    fireEvent.click(screen.getByRole('button', { name: '🔄 お客様の情報を今すぐ取り込む' }));
    const busy = await screen.findByRole('button', { name: '取り込んでいます…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    pending.resolve(response({}));
    expect((await screen.findByRole('status')).textContent).toBe(
      '取り込みました(新しいお客様 1件・変更 3件)',
    );
    expect(queryClient.getQueryData(queryKeys.dataVersion)).toEqual({ dataVersion: '8' });
  });

  it('取込済みなら版数はそのまま。安全装置で止めた(409)ときはエラーのお知らせ', async () => {
    importLatestCsv.mockResolvedValueOnce(response({ status: 'up_to_date', stats: null, dataVersion: '7' }));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.dataVersion, { dataVersion: '7' });
    render(<CustomerCsvImportButton />, { wrapper: createWrapper({ queryClient }) });
    const button = screen.getByRole('button', { name: '🔄 お客様の情報を今すぐ取り込む' });

    fireEvent.click(button);
    expect((await screen.findByRole('status')).textContent).toBe('最新のお客様の情報は取り込み済みです');
    expect(queryClient.getQueryData(queryKeys.dataVersion)).toEqual({ dataVersion: '7' });

    const error = new ApiRequestError(409, { code: 'conflict', message: '取り込みを止めています' });
    importLatestCsv.mockRejectedValueOnce(error);
    fireEvent.click(button);
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(error));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
