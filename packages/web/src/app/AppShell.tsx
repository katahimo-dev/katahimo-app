import { type ReactNode, useState } from 'react';
import { AttendanceTab } from '../features/attendance';
import { ChangePasswordModal, useSession } from '../features/auth';
import { CustomersTab } from '../features/customers';
import { ReportModalProvider } from '../features/report';
import { ScheduleTab } from '../features/schedule';
import { SettingsModal } from '../features/settings';
import { AdminTargetStaffProvider } from './adminTargetStaff';
import { BottomNav } from './BottomNav';
import { useDataVersionPolling } from './dataVersion/useDataVersionPolling';
import { Header } from './Header';
import { type HomeTab, HomeTabsProvider, useHomeTabs } from './homeTabs';
import { useUiConfig } from './uiConfig/useUiConfig';

/**
 * ログイン後の画面の骨格(GAS版 #app)。ヘッダー・3つのタブ・下タブ・設定まわりのダイアログを置く。
 * 各タブの中身・日報ダイアログは features/ 以下の各機能が持つ。
 */
export function AppShell() {
  return (
    <HomeTabsProvider>
      <AdminTargetStaffProvider>
        <ReportModalProvider>
          <ShellLayout />
        </ReportModalProvider>
      </AdminTargetStaffProvider>
    </HomeTabsProvider>
  );
}

function ShellLayout() {
  const { user } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  useDataVersionPolling();
  useUiConfig(); // 日報ダイアログを開く前に読み始めておく(GAS版 loadUiConfig)

  return (
    <div className="min-h-screen flex flex-col relative bg-white shadow-xl overflow-hidden">
      <Header userName={user.name} onOpenSettings={() => setSettingsOpen(true)} />

      <main className="flex-grow p-4 overflow-y-auto pb-24">
        <TabPanel tab="schedule" id="tabSchedule">
          <ScheduleTab />
        </TabPanel>
        <TabPanel tab="visitors" id="tabVisitors">
          <CustomersTab />
        </TabPanel>
        <TabPanel tab="pastSchedule" id="tabPastSchedule">
          <AttendanceTab />
        </TabPanel>
      </main>

      <BottomNav />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenChangePassword={() => setChangePasswordOpen(true)}
      />
      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </div>
  );
}

/**
 * タブの中身。GAS版と同じく、切り替えても中身は捨てずに隠すだけにする(入力途中の値や
 * スクロールの位置が残る)。まだ開いていないタブ(出勤簿)は、初めて開いたときに作る。
 */
function TabPanel({ tab, id, children }: { tab: HomeTab; id: string; children: ReactNode }) {
  const { activeTab, visitedTabs } = useHomeTabs();
  if (!visitedTabs.has(tab)) return null;
  return (
    <div id={id} className={activeTab === tab ? undefined : 'hidden'}>
      {children}
    </div>
  );
}
