import { useQuery } from '@tanstack/react-query';
import { customerQueryKeys, customersApi } from '../../api/customers';

/**
 * 有効なお客様の全件(GAS版 allCustomers / getData)。お客様タブと予定タブ(日報を書くお客様の特定)で共有する。
 * 新しい顧客CSVが取り込まれたときは、データ版数の監視が読み直す(キーが queryKeys.customers.all で始まる)。
 */
export function useCustomerList() {
  return useQuery({
    queryKey: customerQueryKeys.list,
    queryFn: ({ signal }) => customersApi.list(signal),
    staleTime: 30 * 60 * 1000,
  });
}
