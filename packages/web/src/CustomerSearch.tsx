import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { fetchAllCustomers } from './api';
import { CustomerDetail } from './CustomerDetail';
import { getRecentCustomerIds } from './recentCustomers';
import { HistoryModal } from './reports/HistoryModal';
import { ReportModal } from './reports/ReportModal';

/**
 * 「訪問先一覧」タブ。GAS版のtabVisitors(index.html)と同じく、有効な顧客を一度に全件取得して
 * ブラウザ側で絞り込む方式にしている(GAS版のallCustomers/filterCustomers()と同じ設計)。
 * - 顧客名は部分一致・as-you-typeで絞り込む(GAS版のsearchInput/oninput="filterCustomers()"と同じ)。
 * - 地区(市区町村)セレクトで絞り込める(GAS版のcityFilter/onchange="filterCustomers()"と同じ)。
 * - 検索・地区絞り込みのどちらも指定していない既定表示は、直近保存/領収書登録した顧客が
 *   先頭にくる「最近使った順」にする(GAS版filterCustomers()の`if (!search && !city)`分岐と同じ。
 *   recentCustomers.tsのlocalStorage 'recent_customers'を参照)。
 *
 * カードタップ時の挙動もGAS版のopenModal(customer)と同じにしている: カード本体のタップは
 * 日報/事故報告作成モーダル(ReportModal)を開き、「顧客情報」「活動記録」は別ボタンから
 * それぞれ別モーダル(CustomerDetail/HistoryModal)を開く(この3つを混同しないこと)。
 *
 * initialSearchText/onInitialSearchConsumedは、予定タブの予定カードタップ
 * (jumpToCustomerFromSchedule)からこのタブへ切り替わった際に検索欄へ顧客名を
 * 反映するためのもの(App.tsxが管理する一度きりの値、消費したら親側でnullに戻す)。
 */
export function CustomerSearch({
  initialSearchText,
  onInitialSearchConsumed,
}: {
  initialSearchText?: string;
  onInitialSearchConsumed?: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [cityFilter, setCityFilter] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialSearchTextが変わった時だけ反映する意図的な依存
  useEffect(() => {
    if (initialSearchText === undefined) return;
    setSearchText(initialSearchText);
    setCityFilter('');
    onInitialSearchConsumed?.();
  }, [initialSearchText]);
  const [reportCustomerId, setReportCustomerId] = useState<string | null>(null);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [historyCustomer, setHistoryCustomer] = useState<{ id: string; name: string } | null>(null);
  // 報告作成モーダルを閉じるたびに1増やし、useMemoに「最近使った顧客」の並びを再評価させる
  // (保存直後にlocalStorageの'recent_customers'が更新されている可能性があるため)。
  const [recentTick, setRecentTick] = useState(0);

  const query = useQuery({ queryKey: ['customers', 'all'], queryFn: fetchAllCustomers });

  // biome-ignore lint/correctness/useExhaustiveDependencies: recentTickは再評価トリガー専用の意図的な依存
  const filteredCustomers = useMemo(() => {
    const customers = query.data?.customers ?? [];
    const search = searchText.trim().toLowerCase();

    const filtered = customers.filter((c) => {
      const matchesCity = cityFilter ? c.city === cityFilter : true;
      const matchesSearch = search ? c.name.toLowerCase().includes(search) : true;
      return matchesCity && matchesSearch;
    });

    if (!search && !cityFilter) {
      const recentRank = new Map(getRecentCustomerIds().map((id, index) => [id, index]));
      filtered.sort((a, b) => {
        const rankA = recentRank.get(a.id) ?? Number.POSITIVE_INFINITY;
        const rankB = recentRank.get(b.id) ?? Number.POSITIVE_INFINITY;
        return rankA - rankB;
      });
    }

    return filtered;
  }, [query.data, searchText, cityFilter, recentTick]);

  return (
    <div>
      <div className="mb-6 space-y-3">
        <div className="relative flex-grow">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="顧客名で検索..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 bg-gray-50 text-base shadow-sm transition-all"
          />
          <svg
            className="w-5 h-5 absolute left-3 top-3.5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <div className="relative">
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="w-full appearance-none pl-4 pr-10 py-3 rounded-xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 bg-gray-50 text-base shadow-sm transition-all"
          >
            <option value="">全ての地域</option>
            {(query.data?.cities ?? []).map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
            <svg className="fill-current h-4 w-4" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
            </svg>
          </div>
        </div>
      </div>

      {query.isError && <p className="text-red-500 text-sm mb-3">{(query.error as Error).message}</p>}

      {query.isPending && (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
        </div>
      )}

      {query.isSuccess && (
        <div className="space-y-3">
          {filteredCustomers.length === 0 && (
            <div className="text-center text-gray-400 py-8">該当する顧客がいません</div>
          )}
          {filteredCustomers.map((c) => (
            // biome-ignore lint/a11y/useSemanticElements: 内部に顧客情報/活動記録ボタンをネストするため<button>不可(GAS版と同じ構造)
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setReportCustomerId(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setReportCustomerId(c.id);
              }}
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer hover:shadow-md transition-shadow active:bg-gray-50"
            >
              <div className="flex-grow">
                <h3 className="font-bold text-gray-800 text-lg">{c.name}</h3>
                {c.city && (
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs">{c.city}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-2 items-end z-10 relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailCustomerId(c.id);
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                  >
                    顧客情報
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHistoryCustomer({ id: c.id, name: c.name });
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg border border-orange-200 transition-colors"
                  >
                    活動記録
                  </button>
                </div>
                <div className="text-blue-500">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {reportCustomerId && (
        <ReportModal
          customerId={reportCustomerId}
          onClose={() => {
            setReportCustomerId(null);
            setRecentTick((t) => t + 1);
          }}
        />
      )}
      {detailCustomerId && (
        <CustomerDetail customerId={detailCustomerId} onClose={() => setDetailCustomerId(null)} />
      )}
      {historyCustomer && (
        <HistoryModal
          customerId={historyCustomer.id}
          customerName={historyCustomer.name}
          onClose={() => setHistoryCustomer(null)}
        />
      )}
    </div>
  );
}
