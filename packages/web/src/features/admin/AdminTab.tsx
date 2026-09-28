import { isAdminRole } from '@katahimo/shared';
import { useMemo, useState } from 'react';
import { useSession } from '../auth';
import { AiPanel } from './ai/AiPanel';
import { SectionTabPanel, SectionTabs } from './components/SectionTabs';
import { AuditLogPanel } from './logs/AuditLogPanel';
import { ReportListPanel } from './reports/ReportListPanel';
import { NotificationTargetsPanel } from './settings/NotificationTargetsPanel';
import { StaffAdminPanel } from './staff/StaffAdminPanel';
import { UnsavedChangesProvider, useConfirmLeave } from './unsavedChanges';

const ALL_SECTIONS = [
  { key: 'staff', icon: '👤', label: 'スタッフ', adminOnly: true },
  { key: 'reports', icon: '📋', label: '報告一覧', adminOnly: false },
  { key: 'ai', icon: '🤖', label: 'AI', adminOnly: true },
  { key: 'notify', icon: '🔔', label: '通知先', adminOnly: true },
  { key: 'logs', icon: '📄', label: '操作ログ', adminOnly: true },
] as const;

type Section = (typeof ALL_SECTIONS)[number]['key'];

/**
 * 「🛠 管理」タブ(管理者・コーディネーター)。GAS版で管理者がスプレッドシートを直接編集・閲覧していた作業
 * (スタッフ台帳・「ＡＩプロンプト」シート・「日報」「事故報告」シート)と、Drive の CSV ログの確認の置き換え。
 * GAS版で設定ダイアログの「詳細設定」にあった Gemini の APIキー・モデル(→ AI)と Google Chat の通知先(→ 通知先)もここに置く。
 * 「AI」は APIキー・モデル・プロンプト(指示文)・日報AIの調整(差し込む言葉の表)をまとめる。
 * コーディネーターには「報告一覧」だけを出す。表示を切り替えると前の表示の中身は捨てるため、保存していない変更があれば確かめる。
 */
export function AdminTab() {
  return (
    <UnsavedChangesProvider>
      <AdminSections />
    </UnsavedChangesProvider>
  );
}

function AdminSections() {
  const { user } = useSession();
  const isAdmin = isAdminRole(user.role);
  const confirmLeave = useConfirmLeave();
  const sections = useMemo(() => ALL_SECTIONS.filter((s) => isAdmin || !s.adminOnly), [isAdmin]);
  const [section, setSection] = useState<Section>(() => sections[0]?.key ?? 'reports');

  const switchTo = async (next: Section) => {
    if (!(await confirmLeave())) return false;
    setSection(next);
    return true;
  };

  const panel = (
    <>
      {section === 'staff' ? <StaffAdminPanel /> : null}
      {section === 'reports' ? <ReportListPanel /> : null}
      {section === 'ai' ? <AiPanel /> : null}
      {section === 'notify' ? <NotificationTargetsPanel /> : null}
      {section === 'logs' ? <AuditLogPanel /> : null}
    </>
  );

  return (
    <div className="space-y-3">
      <h1 className="text-base font-bold text-gray-800">🛠 管理</h1>
      {sections.length > 1 ? (
        <>
          <SectionTabs
            tabs={sections}
            selected={section}
            onSelect={switchTo}
            label="管理の項目"
            idPrefix="admin"
          />
          <SectionTabPanel idPrefix="admin" tabKey={section}>
            {panel}
          </SectionTabPanel>
        </>
      ) : (
        <div id={`adminPanel-${section}`}>{panel}</div>
      )}
    </div>
  );
}
