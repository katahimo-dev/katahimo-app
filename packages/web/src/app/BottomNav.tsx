import { useSession } from '../features/auth';
import { homeTabsFor, useHomeTabs } from './homeTabs';

/**
 * GAS版の下部固定タブ。#app が overflow-hidden のため sticky では本文が長いと画面外へ切れてしまう。
 * GAS版と同じく position: fixed でビューポート基準に固定し、#app と同じ幅(app-width)・中央寄せにしている。
 */
export function BottomNav() {
  const { activeTab, switchTab } = useHomeTabs();
  const { user } = useSession();
  return (
    <nav className="app-width fixed bottom-0 left-1/2 -translate-x-1/2 z-20 flex bg-white border-t border-gray-200">
      {homeTabsFor(user.role).map((tab) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => switchTab(tab.key)}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 min-h-16 py-2 flex flex-col items-center justify-center gap-0.5 text-sm font-bold border-t-2 transition-colors ${
              active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600'
            }`}
          >
            <span className="text-2xl leading-none">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
