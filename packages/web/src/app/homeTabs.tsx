import type { StaffRole } from '@katahimo/shared';
import { isAdminRole } from '@katahimo/shared';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/**
 * 下タブ(GAS版 HOME_TAB_IDS / switchHomeTab)。GAS版はURLを変えずに表示を切り替えるだけなので、
 * こちらもURLルーティングは使わない。adminOnly のタブ(🛠 管理)は管理者にだけ出す(サーバーの API も管理者だけ)。
 */
export const HOME_TABS = [
  { key: 'schedule', icon: '📅', label: '今日の予定', adminOnly: false },
  { key: 'visitors', icon: '👪', label: 'お客様', adminOnly: false },
  { key: 'pastSchedule', icon: '🕒', label: '出勤簿', adminOnly: false },
  { key: 'admin', icon: '🛠', label: '管理', adminOnly: true },
] as const;

export type HomeTab = (typeof HOME_TABS)[number]['key'];

/** その役割の人に見せる下タブ。 */
export function homeTabsFor(role: StaffRole) {
  return HOME_TABS.filter((tab) => !tab.adminOnly || isAdminRole(role));
}

interface HomeTabsContextValue {
  activeTab: HomeTab;
  /** 一度でも開いたタブ(出勤簿タブはGAS版と同じく初めて開いたときに読み込みを始める) */
  visitedTabs: ReadonlySet<HomeTab>;
  /** タブを切り替える(GAS版 switchHomeTab)。予定→お客様への移動などで機能側からも呼ぶ。 */
  switchTab: (tab: HomeTab) => void;
}

const HomeTabsContext = createContext<HomeTabsContextValue | null>(null);

export function HomeTabsProvider({ children }: { children: ReactNode }) {
  // GAS版は起動時に switchHomeTab('schedule')
  const [activeTab, setActiveTab] = useState<HomeTab>('schedule');
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<HomeTab>>(
    () => new Set(['schedule', 'visitors']),
  );

  const switchTab = useCallback((tab: HomeTab) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, []);

  const value = useMemo(() => ({ activeTab, visitedTabs, switchTab }), [activeTab, visitedTabs, switchTab]);
  return <HomeTabsContext value={value}>{children}</HomeTabsContext>;
}

export function useHomeTabs(): HomeTabsContextValue {
  const value = useContext(HomeTabsContext);
  if (!value) throw new Error('useHomeTabs は HomeTabsProvider の中で使ってください');
  return value;
}
