import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ReportModal } from './components/ReportModal';
import { usePendingDraftRestore } from './hooks/usePendingDraftRestore';
import type { ReportModalApi, ReportSession, ReportTarget } from './types';

export type { ReportModalApi, ReportTarget } from './types';

/**
 * 日報・事故報告のダイアログ(GAS版 #reportModal / openModal)と、お客様に関係ない領収書の登録
 * (GAS版 openStandaloneReceiptModal)を開くための入口。ダイアログ本体もこの Provider が描画する。
 *
 * 予定タブ(「✏️ この訪問の日報を書く」)・お客様タブ(「✏️ 日報を書く」「🧾 お客様に関係ない
 * 領収書を登録」)からは `useReportModal()` で開く。呼び出し口の形(ReportTarget / ReportModalApi)を
 * 変えるときは、予定・お客様の担当と相談すること。
 */
const ReportModalContext = createContext<ReportModalApi | null>(null);

export function ReportModalProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ReportSession | null>(null);
  const [open, setOpen] = useState(false);

  const openReport = useCallback((target: ReportTarget) => {
    setSession((prev) => ({ kind: 'customer', target, nonce: (prev?.nonce ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const openStandaloneReceipt = useCallback(() => {
    setSession((prev) => ({ kind: 'standalone', nonce: (prev?.nonce ?? 0) + 1 }));
    setOpen(true);
  }, []);

  const api = useMemo<ReportModalApi>(
    () => ({ openReport, openStandaloneReceipt }),
    [openReport, openStandaloneReceipt],
  );

  // アプリを開いた直後に一度だけ、保存されずに残っている日報のお客様を開く(GAS版 restoreReportDraftIfAny)
  usePendingDraftRestore(openReport);

  // 見比べハーネス(tools/gas-preview)から開けるようにする。開発サーバーのときだけ。
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __katahimoReport?: ReportModalApi };
    w.__katahimoReport = api;
    return () => {
      delete w.__katahimoReport;
    };
  }, [api]);

  return (
    <ReportModalContext value={api}>
      {children}
      <ReportModal session={session} open={open} onClose={() => setOpen(false)} />
    </ReportModalContext>
  );
}

export function useReportModal(): ReportModalApi {
  const value = useContext(ReportModalContext);
  if (!value) throw new Error('useReportModal は ReportModalProvider の中で使ってください');
  return value;
}
