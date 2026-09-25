import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { customerQueryKeys, customersApi } from '../../api/customers';

/**
 * 「これまでの記録」の読み込み(GAS版 loadCustomerHistory)。新しい順に5件ずつ読み、
 * 「さらに前の記録を見る」で続きの5件を足す(続きの位置はサーバーが返す nextCursor)。
 *
 * GAS版は開くたびに最初の5件から読み直していたため、閉じたら(ダイアログが消えたら)すぐに捨てる
 * (gcTime: 0)。「🔄 最新にする」も最初の5件から読み直す。
 */
export function useCustomerHistory(customerId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = customerQueryKeys.history(customerId);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => customersApi.history(customerId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && Boolean(customerId),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  const reload = useCallback(() => {
    void queryClient.resetQueries({ queryKey, exact: true });
  }, [queryClient, queryKey]);

  return { query, reload };
}
