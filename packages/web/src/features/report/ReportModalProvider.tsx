import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { showToast } from '../../ui/toast';

/**
 * 日報・事故報告のダイアログ(GAS版 #reportModal / openModal)と、お客様に関係ない領収書の登録
 * (GAS版 openStandaloneReceiptModal)を開くための入口。
 *
 * 予定タブ(「✏️ この訪問の日報を書く」)・お客様タブ(「✏️ 日報を書く」「🧾 お客様に関係ない
 * 領収書を登録」)からは `useReportModal()` で開く。ダイアログ本体はこの Provider が描画する。
 *
 * 担当: 日報の担当(packages/web/README.md「機能ごとの担当」)。ここは呼び出し口だけの仮置き。
 * 呼び出し口の形(ReportTarget / ReportModalApi)を変えるときは、予定・お客様の担当と相談すること。
 */
export interface ReportTarget {
  /** 日報を書くお客様(GET /api/customers/:id で世帯構成員などを読む) */
  customerId: string;
  /** 読み込み中の見出しなどに使う表示名 */
  customerName: string;
}

export interface ReportModalApi {
  /** お客様の日報ダイアログを開く(GAS版 openModal(customer)) */
  openReport: (target: ReportTarget) => void;
  /** お客様の指定なしの領収書登録を開く(GAS版 openStandaloneReceiptModal) */
  openStandaloneReceipt: () => void;
}

const ReportModalContext = createContext<ReportModalApi | null>(null);

export function ReportModalProvider({ children }: { children: ReactNode }) {
  const api = useMemo<ReportModalApi>(
    () => ({
      openReport: () => showToast('日報の画面は準備中です'),
      openStandaloneReceipt: () => showToast('領収書の画面は準備中です'),
    }),
    [],
  );
  return <ReportModalContext.Provider value={api}>{children}</ReportModalContext.Provider>;
}

export function useReportModal(): ReportModalApi {
  const value = useContext(ReportModalContext);
  if (!value) throw new Error('useReportModal は ReportModalProvider の中で使ってください');
  return value;
}
