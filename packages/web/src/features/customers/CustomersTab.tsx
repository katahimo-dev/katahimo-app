import type { CustomerListItem } from '@katahimo/shared';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Loading } from '../../ui/StatusViews';
import { showErrorToast } from '../../ui/toast';
import { useReportModal } from '../report';
import { CustomerCard } from './CustomerCard';
import { CustomerDetailModal } from './CustomerDetailModal';
import { CustomerFilters } from './CustomerFilters';
import { CustomerHistoryModal } from './CustomerHistoryModal';
import { filterCustomers, readRecentCustomerIds } from './customerFilter';
import { useCustomerSearch } from './customerSearchStore';
import { useCustomerList } from './useCustomerList';
import { useModalTarget } from './useModalTarget';

/**
 * 「👪 お客様」タブ(GAS版 #tabVisitors)。探す欄・地区・お客様に関係ない領収書・お客様の一覧と、
 * 「お客様の情報」「これまでの記録」のダイアログ。
 */
export function CustomersTab() {
  const customersQuery = useCustomerList();
  const [search, setSearch] = useCustomerSearch();
  const [city, setCity] = useState('');
  const { openReport, openStandaloneReceipt } = useReportModal();
  const detail = useModalTarget<CustomerListItem>();
  const history = useModalTarget<CustomerListItem>();

  // 読み込みに失敗したら赤いお知らせ(GAS版 onError)。一覧は読み込み中の表示のまま
  const { errorUpdateCount, error } = customersQuery;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 失敗するたびに1回だけ出す(errorUpdateCount が増えたとき)
  useEffect(() => {
    if (errorUpdateCount > 0 && error) showErrorToast(error);
  }, [errorUpdateCount]);

  const data = customersQuery.data;
  const filtered = useMemo(
    () => (data ? filterCustomers(data.customers, { search, city }, readRecentCustomerIds()) : []),
    [data, search, city],
  );

  return (
    <>
      <CustomerFilters
        search={search}
        onSearchChange={setSearch}
        city={city}
        onCityChange={setCity}
        cities={data?.cities ?? []}
        loaded={Boolean(data)}
      />

      {/* ふだんはほとんど使わない操作だが、一覧の一番下ではお客様が多いとたどりつけないため、
          探す欄のすぐ下・一覧の上に控えめな見た目で置く(GAS版と同じ) */}
      <button
        type="button"
        id="standaloneReceiptBtn"
        onClick={openStandaloneReceipt}
        className="w-full mb-4 min-h-12 py-3 bg-white border-2 border-dashed border-gray-300 text-gray-700 text-base font-bold rounded-xl transition-colors"
      >
        🧾 お客様に関係ない領収書を登録
      </button>

      <div id="customerList" className="space-y-3">
        {!data ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <CustomerEmptyState hasFilter={Boolean(search || city)} />
        ) : (
          filtered.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              onWriteReport={() => openReport({ customerId: customer.id, customerName: customer.name })}
              onShowDetail={() => detail.open(customer)}
              onShowHistory={() => history.open(customer)}
            />
          ))
        )}
      </div>

      <CustomerDetailModal open={detail.isOpen} customer={detail.target} onClose={detail.close} />
      <CustomerHistoryModal open={history.isOpen} customer={history.target} onClose={history.close} />
    </>
  );
}

/**
 * 0件のとき(GAS版 renderCustomers)。絞り込みをしていないのに0件なら、お客様の情報そのものが
 * 取り込まれていない(探し方の問題ではない)ので、次にすることを変えて伝える。
 */
function CustomerEmptyState({ hasFilter }: { hasFilter: boolean }) {
  return hasFilter ? (
    <EmptyState icon="🔍" title="見つかりませんでした" hint="名前の一部だけで探せます" />
  ) : (
    <EmptyState icon="📭" title="お客様の情報がまだありません" hint="事務局へ連絡してください" />
  );
}
