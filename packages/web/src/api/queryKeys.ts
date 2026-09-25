/**
 * TanStack Query のキー。機能をまたいで無効化(invalidate)する必要があるキーはここに集める。
 *
 * - `customers`: 顧客データ。データ版数の監視(app/dataVersion)が、新しい顧客CSVが取り込まれたときに
 *   `queryKeys.customers.all` 以下をまとめて読み直す。お客様タブ・予定タブ(お客様の特定)で
 *   顧客を読むクエリは必ず `queryKeys.customers.all` で始まるキーにすること。
 * - 各機能の中だけで使うキーは、その機能のフォルダで `[機能名, ...]` の形で定義してよい。
 */
export const queryKeys = {
  session: ['auth', 'me'] as const,
  uiConfig: ['ui-config'] as const,
  activeStaff: ['staff', 'active'] as const,
  customers: {
    all: ['customers'] as const,
  },
};
