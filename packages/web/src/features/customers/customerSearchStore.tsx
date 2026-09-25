import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

/**
 * お客様タブの「お客様の名前で探す」欄の文字。予定タブから「お客様一覧から選んでください」で
 * お客様タブへ移るとき(GAS版 jumpToCustomerFromSchedule)に、予定の件名をこの欄に入れるため、
 * 両方のタブから触れるようにしている。
 *
 * ログイン後の画面(AppShell)の中にだけ置くので、ログアウト・セッション切れでログイン画面に戻ると
 * 空に戻る(次にログインした人に前の人の探した文字が残らない)。
 */
type SearchState = readonly [string, (value: string) => void];

const CustomerSearchContext = createContext<SearchState | null>(null);

export function CustomerSearchProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState('');
  const value = useMemo(() => [search, setSearch] as const, [search]);
  return <CustomerSearchContext value={value}>{children}</CustomerSearchContext>;
}

export function useCustomerSearch(): SearchState {
  const value = useContext(CustomerSearchContext);
  if (!value) throw new Error('useCustomerSearch は CustomerSearchProvider の中で使ってください');
  return value;
}

/** 探す欄に文字を入れる(予定タブから) */
export function useSetCustomerSearch(): (value: string) => void {
  return useCustomerSearch()[1];
}
