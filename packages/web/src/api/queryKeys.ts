/**
 * TanStack Query のキー。機能をまたいで無効化(invalidate)する必要があるキーはここに集める。
 *
 * - `customers`: 顧客データ。データ版数の監視(app/dataVersion)が、新しい顧客CSVが取り込まれたときに
 *   `queryKeys.customers.all` 以下をまとめて読み直す。お客様タブ・予定タブ(お客様の特定)で
 *   顧客を読むクエリは必ず `queryKeys.customers.all` で始まるキーにすること。
 * - `receipts`: 領収書の一覧(出勤簿タブの「🧾 領収書」)。日報の画面で領収書を送ったら `queryKeys.receipts.all` 以下を
 *   読み直す(一覧を開いたままでも送ったばかりの領収書が出るように)。
 * - `reports`: 日報・事故報告の一覧・中身(管理タブの「📋 報告一覧」)。日報・事故報告を保存したら `queryKeys.reports.all`
 *   以下を読み直す(一度開いたタブは隠れたまま残るため、読み直さないと保存したばかりの報告が出ない)。
 * - 各機能の中だけで使うキーは、その機能のフォルダで `[機能名, ...]` の形で定義してよい。
 */
export const queryKeys = {
  session: ['auth', 'me'] as const,
  uiConfig: ['ui-config'] as const,
  /** 顧客データの版数(customers の下に置かない。読み直しの対象にならないように) */
  dataVersion: ['system', 'data-version'] as const,
  activeStaff: ['staff', 'active'] as const,
  customers: {
    all: ['customers'] as const,
  },
  receipts: {
    all: ['receipts'] as const,
  },
  reports: {
    all: ['reports'] as const,
  },
};
