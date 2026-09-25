import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { customerQueryKeys, customersApi } from '../../../api/customers';
import { useHomeTabs } from '../../../app/homeTabs';
import { useSession } from '../../auth';
import { readPendingDraft } from '../model/reportDraft';
import type { ReportTarget } from '../types';

/**
 * アプリを開いた直後に一度だけ、保存されずに残っている日報があれば、そのお客様の日報ダイアログを
 * 自動で開く(GAS版 restoreReportDraftIfAny)。内容を戻すのはダイアログを開いたとき(どのお客様を
 * 開いても戻す。GAS版 applyPendingReportDraft_)。お客様がもう一覧にいなければ開かない。
 */
export function usePendingDraftRestore(openReport: (target: ReportTarget) => void) {
  const { switchTab } = useHomeTabs();
  const { storageScope } = useSession();
  // 開いた時点の書きかけだけを見る(あとから書きかけが増えても自動では開かない)
  const [draftCustomerId] = useState(() => readPendingDraft(storageScope)?.customerId ?? null);
  const attemptedRef = useRef(false);

  const { data } = useQuery({
    // お客様タブの一覧と同じクエリ(読み取りだけ。お客様タブが読んだ一覧をそのまま使う)
    queryKey: customerQueryKeys.list,
    queryFn: ({ signal }) => customersApi.list(signal),
    enabled: draftCustomerId !== null,
  });

  useEffect(() => {
    if (attemptedRef.current || !draftCustomerId || !data) return;
    attemptedRef.current = true;
    // 読み込んでいるあいだに保存された(書きかけが消えた)ときは開かない
    if (readPendingDraft(storageScope)?.customerId !== draftCustomerId) return;
    const customer = data.customers.find((c) => c.id === draftCustomerId);
    if (!customer) return;
    switchTab('visitors');
    openReport({ customerId: customer.id, customerName: customer.name });
  }, [data, draftCustomerId, openReport, switchTab, storageScope]);
}
