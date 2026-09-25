import { useSyncExternalStore } from 'react';

/**
 * お客様タブの「お客様の名前で探す」欄の文字。予定タブから「お客様一覧から選んでください」で
 * お客様タブへ移るとき(GAS版 jumpToCustomerFromSchedule)に、予定の件名をこの欄に入れるため、
 * 両方のタブから触れる小さなストアにしている。
 */
type Listener = () => void;

let search = '';
const listeners = new Set<Listener>();

export function setCustomerSearch(value: string) {
  if (value === search) return;
  search = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCustomerSearch(): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => search);
  return [value, setCustomerSearch];
}
