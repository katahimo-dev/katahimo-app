import { type CustomerListItem, canActForOthers } from '@katahimo/shared';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { readRecentCustomerIds } from '../../lib/recentCustomers';
import { EmptyState, Loading } from '../../ui/StatusViews';
import { showErrorToast } from '../../ui/toast';
import { useSession } from '../auth';
import { useReportModal } from '../report';
import { CustomerCard } from './CustomerCard';
import { CustomerCsvImportButton } from './CustomerCsvImportButton';
import { CustomerDetailModal } from './CustomerDetailModal';
import { CustomerFilters } from './CustomerFilters';
import { CustomerHistoryModal } from './CustomerHistoryModal';
import { filterCustomers } from './customerFilter';
import { useCustomerSearch } from './customerSearchStore';
import { useCustomerList } from './useCustomerList';
import { useModalTarget } from './useModalTarget';

/**
 * 「👪 お客様」タブ(GAS版 #tabVisitors)。探す欄・地区・お客様に関係ない領収書・お客様の情報の取込
 * (コーディネーター・管理者)・お客様の一覧と、
 * 「お客様の情報」「これまでの記録」のダイアログ。
 */
export function CustomersTab() {
  const customersQuery = useCustomerList();
  const [search, setSearch] = useCustomerSearch();
  const [city, setCity] = useState('');
  const { openReport, openStandaloneReceipt } = useReportModal();
  const { storageScope, user } = useSession();
  const detail = useModalTarget<CustomerListItem>();
  const history = useModalTarget<CustomerListItem>();
  const { open: openDetail } = detail;
  const { open: openHistory } = history;
  const writeReport = useCallback(
    (customer: CustomerListItem) => openReport({ customerId: customer.id, customerName: customer.name }),
    [openReport],
  );

  // 読み込みに失敗したら赤いお知らせ(GAS版 onError)。一覧は読み込み中の表示のまま
  const { errorUpdateCount, error } = customersQuery;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 失敗するたびに1回だけ出す(errorUpdateCount が増えたとき)
  useEffect(() => {
    if (errorUpdateCount > 0 && error) showErrorToast(error);
  }, [errorUpdateCount]);

  const data = customersQuery.data;
  // 一覧の絞り込みは入力より後回しにする(お客様が多くても文字の入力が引っかからないように)
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(
    // 最近のお客様は絞り込みを変えるたびに読み直す(GAS版 filterCustomers と同じ)
    () =>
      data
        ? filterCustomers(
            data.customers,
            { search: deferredSearch, city },
            readRecentCustomerIds(storageScope),
          )
        : [],
    [data, deferredSearch, city, storageScope],
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

      {/* 新しいお客様が見つからないとき、定期の取込(10分ごと)を待たずに取り込む(コーディネーター・管理者だけ) */}
      {canActForOthers(user.role) ? <CustomerCsvImportButton /> : null}

      <div id="customerList" className="space-y-3">
        {!data ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <CustomerEmptyState hasFilter={Boolean(deferredSearch || city)} />
        ) : (
          filtered.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              onWriteReport={writeReport}
              onShowDetail={openDetail}
              onShowHistory={openHistory}
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
