import {
  customerDetailResponseSchema,
  customerHistoryResponseSchema,
  customerListResponseSchema,
} from '@katahimo/shared';
import { api } from './client';
import { queryKeys } from './queryKeys';

/**
 * お客様のAPI。クエリキーは必ず `queryKeys.customers.all` で始める(新しい顧客CSVが取り込まれたとき、
 * データ版数の監視がまとめて読み直すため)。
 */
export const customerQueryKeys = {
  list: [...queryKeys.customers.all, 'list'] as const,
  detail: (customerId: string) => [...queryKeys.customers.all, 'detail', customerId] as const,
  history: (customerId: string) => [...queryKeys.customers.all, 'history', customerId] as const,
};

export const customersApi = {
  /** GET /api/customers: 有効なお客様の全件と地区の一覧(GAS版 getData)。 */
  list: (signal?: AbortSignal) =>
    api.get('/api/customers', customerListResponseSchema, undefined, { signal }),
  /** GET /api/customers/:id: お客様1件の全項目と世帯構成員(GAS版 getData の details / family)。 */
  detail: (customerId: string, signal?: AbortSignal) =>
    api.get(`/api/customers/${encodeURIComponent(customerId)}`, customerDetailResponseSchema, undefined, {
      signal,
    }),
  /**
   * GET /api/reports/history: これまでの記録を新しい順に5件(GAS版 getCustomerReports)。
   * before に前回の最後の occurredAtIso を渡すと、その次の5件。
   */
  history: (customerId: string, before: string | undefined, signal?: AbortSignal) =>
    api.get('/api/reports/history', customerHistoryResponseSchema, { customerId, before }, { signal }),
};
