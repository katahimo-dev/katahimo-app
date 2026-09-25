import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminTargetStaffProvider } from './AdminTargetStaffContext';
import { AttendanceTab } from './AttendanceTab';
import type { StaffView } from './api';
import { fetchMe, logout } from './api';
import { CustomerSearch } from './CustomerSearch';
import { LoginForm } from './LoginForm';
import { ScheduleTab } from './ScheduleTab';
import { SettingsModal } from './settings/SettingsModal';

type HomeTab = 'schedule' | 'visitors' | 'attendance';

const TABS: { key: HomeTab; icon: string; label: string }[] = [
  { key: 'schedule', icon: '📅', label: '予定' },
  { key: 'visitors', icon: '🏠', label: '訪問先一覧' },
  { key: 'attendance', icon: '🕒', label: '勤怠' },
];

/**
 * アプリ全体の骨格。GAS版(gas-childcare-visit-app/index.html)と同じ、ヘッダー+3タブ構成の
 * 単一ページアプリにしている(移行時の混乱を減らすため)。GAS版はURLルーティングを一切使わず
 * タブの表示/非表示切り替えだけで画面遷移するため、こちらもURLは変えずタブをstateで切り替える
 * 作りにしている(react-router-domは使わない)。
 *
 * タブ切り替えはGAS版と同様、スマホでの操作性のため下部固定ボタンにしている(GAS版
 * gas-childcare-visit-app/index.htmlのホームタブと同じ配置)。ルート要素が`overflow-hidden`
 * (下記)なので`sticky`は本文が長い時に画面外へクリップされる。GAS版と同じ理由で`fixed`にし、
 * ビューポート基準+`left-1/2 -translate-x-1/2`でアプリ幅(`max-width: 480px`、index.htmlの
 * #rootと同じ)に中央寄せして常に表示されるようにする。
 */
function AppShell({ staff, onLogout }: { staff: StaffView; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<HomeTab>('schedule');
  const [showSettings, setShowSettings] = useState(false);
  // 予定タブの予定カードタップで訪問先一覧タブへ切り替え、検索欄にその顧客名を入れる
  // (GAS版jumpToCustomerFromScheduleと同じ動作)。
  const [jumpSearchText, setJumpSearchText] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col relative bg-white shadow-xl overflow-hidden">
      <header className="bg-blue-600 text-white p-4 shadow-md z-10 sticky top-0 flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold tracking-wider">katahimo 訪問管理</h1>
          <span className="text-[10px] opacity-70 font-mono">Ver. 0.1 (katahimo-app)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium opacity-90">{staff.name}</span>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
            title="設定"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
            title="ログアウト"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-grow p-4 overflow-y-auto pb-24">
        <AdminTargetStaffProvider staff={staff}>
          {activeTab === 'schedule' && (
            <ScheduleTab
              onJumpToCustomer={(name) => {
                setJumpSearchText(name);
                setActiveTab('visitors');
              }}
            />
          )}
          {activeTab === 'visitors' && (
            <CustomerSearch
              initialSearchText={jumpSearchText ?? undefined}
              onInitialSearchConsumed={() => setJumpSearchText(null)}
            />
          )}
          {activeTab === 'attendance' && <AttendanceTab />}
        </AdminTargetStaffProvider>
      </main>

      <nav
        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-20 flex bg-white border-t border-gray-200"
        style={{ width: '100%', maxWidth: '480px' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 flex flex-col items-center gap-0.5 text-xs font-bold border-t-2 transition-colors ${
              activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'
            }`}
          >
            <span className="text-lg leading-none">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {showSettings && <SettingsModal staff={staff} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState<StaffView | null | undefined>(undefined);

  // 初回だけCookieセッションの有無を確認する(ページ再読み込み後もログイン状態を保つため)。
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const result = await fetchMe();
      setStaff(result);
      return result;
    },
    enabled: staff === undefined,
    retry: false,
  });

  if (staff === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
      </div>
    );
  }

  if (!staff) {
    return <LoginForm onLoggedIn={setStaff} />;
  }

  const handleLogout = async () => {
    await logout();
    setStaff(null);
    queryClient.removeQueries({ queryKey: ['me'] });
  };

  return <AppShell staff={staff} onLogout={handleLogout} />;
}
