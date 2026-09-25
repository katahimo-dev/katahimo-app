import type { CustomerListItem } from '@katahimo/shared';
import { useCallback, useRef } from 'react';
import { useHomeTabs } from '../../app/homeTabs';
import { showToast } from '../../ui/toast';
import { setCustomerSearch, useCustomerList } from '../customers';
import { useReportModal } from '../report';
import { findCustomerByScheduleName } from './findCustomerByScheduleName';

/**
 * 予定カードの「✏️ この訪問の日報を書く」(GAS版 openReportFromSchedule)。
 *
 * - お客様を1件に決められたら、お客様タブを通らずにそのまま日報ダイアログを開く。
 * - 決められないときは、お客様タブへ移って探す欄に件名を入れ、「お客様一覧から選んでください」。
 * - お客様一覧がまだ届いていないときは「お客様の情報を読み込んでいます…」を出し、届いたら開く
 *   (届いても0件なら「お客様の情報を読み込めませんでした…」。読み込みに失敗したら開かない。
 *   失敗のお知らせはお客様タブが出す)。待っている間に別の予定を押したら、あとに押した方だけを開く。
 */
export function useOpenReportFromSchedule(): (scheduleName: string) => void {
  const customersQuery = useCustomerList();
  const { openReport } = useReportModal();
  const { switchTab } = useHomeTabs();
  const pendingNameRef = useRef<string | null>(null);

  const customers = customersQuery.data?.customers;
  const { refetch } = customersQuery;

  const openWith = useCallback(
    (list: readonly CustomerListItem[], scheduleName: string) => {
      const customer = findCustomerByScheduleName(list, scheduleName);
      if (customer) {
        openReport({ customerId: customer.id, customerName: customer.name });
        return;
      }
      // 見つからない・どれか決められないときは、お客様一覧から選んでもらう(GAS版 jumpToCustomerFromSchedule)
      switchTab('visitors');
      setCustomerSearch(scheduleName);
      showToast('お客様一覧から選んでください');
    },
    [openReport, switchTab],
  );

  return useCallback(
    (scheduleName: string) => {
      if (!scheduleName) return;
      if (customers && customers.length > 0) {
        openWith(customers, scheduleName);
        return;
      }
      pendingNameRef.current = scheduleName;
      showToast('お客様の情報を読み込んでいます…');
      void refetch().then((result) => {
        if (pendingNameRef.current !== scheduleName) return;
        pendingNameRef.current = null;
        if (result.isError) return;
        const list = result.data?.customers ?? [];
        if (list.length > 0) openWith(list, scheduleName);
        else showToast('お客様の情報を読み込めませんでした。電波を確認して、もう一度押してください', true);
      });
    },
    [customers, refetch, openWith],
  );
}
