/**
 * 日報ダイアログの呼び出し口の型(予定・お客様の担当もこの形で呼ぶ。変えるときは相談すること)。
 */
export interface ReportTarget {
  /** 日報を書くお客様(GET /api/customers/:id で住所・世帯構成員を読む) */
  customerId: string;
  /** 読み込むまでの見出しなどに使う表示名 */
  customerName: string;
}

export interface ReportModalApi {
  /** お客様の日報ダイアログを開く(GAS版 openModal(customer)) */
  openReport: (target: ReportTarget) => void;
  /** お客様の指定なしの領収書登録を開く(GAS版 openStandaloneReceiptModal) */
  openStandaloneReceipt: () => void;
}

/**
 * いま開いている(開いていた)ダイアログ。nonce は開くたびに増える番号で、開き直したときに
 * 入力を初めの状態に戻すきっかけと、前に開いたときの通信の結果を捨てる目印に使う。
 */
export type ReportSession =
  | { kind: 'customer'; target: ReportTarget; nonce: number }
  | { kind: 'standalone'; nonce: number };
