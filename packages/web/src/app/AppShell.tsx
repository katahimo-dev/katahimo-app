import { canActForOthers } from '@katahimo/shared';
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { ChangePasswordModal, useSession } from '../features/auth';
import { CustomerSearchProvider, CustomersTab } from '../features/customers';
import { ReportModalProvider } from '../features/report';
import { ScheduleTab, useScheduleLinkNavigation } from '../features/schedule';
import { SettingsModal } from '../features/settings';
import { runWhenIdle } from '../lib/idle';
import { SectionErrorBoundary } from '../ui/ErrorBoundary';
import { AdminTargetStaffProvider } from './adminTargetStaff';
import { BottomNav } from './BottomNav';
import { useDataVersionPolling } from './dataVersion/useDataVersionPolling';
import { Header } from './Header';
import { type HomeTab, HomeTabsProvider, useHomeTabs } from './homeTabs';
import { useUiConfig } from './uiConfig/useUiConfig';

// 出勤簿タブは初めて開いたときに作る(GAS版と同じ)ので、JSも分けておき、手が空いたときに先に読む
const loadAttendance = () => import('../features/attendance');
const AttendanceTab = lazy(() => loadAttendance().then((m) => ({ default: m.AttendanceTab })));
// 管理タブは管理者・コーディネーターだけが開くので、JSを分けて開いたときに読む
const AdminTab = lazy(() => import('../features/admin').then((m) => ({ default: m.AdminTab })));

/**
 * ログイン後の画面の骨格(GAS版 #app)。ヘッダー・3つのタブ(管理者・コーディネーターは「🛠 管理」を加えた4つ)・下タブ・
 * 設定まわりのダイアログを置く。
 * 各タブの中身・日報ダイアログは features/ 以下の各機能が持つ。
 */
export function AppShell() {
  return (
    <HomeTabsProvider>
      <AdminTargetStaffProvider>
        <CustomerSearchProvider>
          <ReportModalProvider>
            <ShellLayout />
          </ReportModalProvider>
        </CustomerSearchProvider>
      </AdminTargetStaffProvider>
    </HomeTabsProvider>
  );
}

function ShellLayout() {
  const { user } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  useDataVersionPolling();
  useScheduleLinkNavigation();
  useUiConfig(); // 日報ダイアログを開く前に読み始めておく(GAS版 loadUiConfig)
  useEffect(() => runWhenIdle(() => void loadAttendance()), []);
  useWideLayoutFor('admin');

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
          <Suspense fallback={null}>
            <AttendanceTab />
          </Suspense>
        </TabPanel>
        {canActForOthers(user.role) ? (
          <TabPanel tab="admin" id="tabAdmin">
            <Suspense fallback={null}>
              <AdminTab />
            </Suspense>
          </TabPanel>
        ) : null}
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
 * タブの中で描画が失敗しても、ほかのタブ・ヘッダーは使えるようにする(SectionErrorBoundary)。
 */
function TabPanel({ tab, id, children }: { tab: HomeTab; id: string; children: ReactNode }) {
  const { activeTab, visitedTabs } = useHomeTabs();
  if (!visitedTabs.has(tab)) return null;
  return (
    <div id={id} className={activeTab === tab ? undefined : 'hidden'}>
      <SectionErrorBoundary>{children}</SectionErrorBoundary>
    </div>
  );
}

/**
 * 指定のタブを開いている間だけ、アプリの幅を広げる(html の data-layout="wide"。幅は styles/index.css の app-width)。
 * 管理タブはパソコンで見ることが多いので広く使い、スタッフが使うほかのタブはスマホの幅のままにする。
 */
function useWideLayoutFor(tab: HomeTab) {
  const { activeTab } = useHomeTabs();
  const wide = activeTab === tab;
  useEffect(() => {
    if (!wide) return;
    const root = document.documentElement;
    root.dataset.layout = 'wide';
    return () => {
      delete root.dataset.layout;
    };
  }, [wide]);
}
