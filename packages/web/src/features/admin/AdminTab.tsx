import { isAdminRole } from '@katahimo/shared';
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useConfirmModal } from '../../ui/confirm';
import { useSession } from '../auth';
import { AuditLogPanel } from './logs/AuditLogPanel';
import { PromptsPanel } from './prompts/PromptsPanel';
import { ReportListPanel } from './reports/ReportListPanel';
import { StaffAdminPanel } from './staff/StaffAdminPanel';

const ALL_SECTIONS = [
  { key: 'staff', label: '👤 スタッフ', adminOnly: true },
  { key: 'reports', label: '📋 報告一覧', adminOnly: false },
  { key: 'prompts', label: '🤖 AIプロンプト', adminOnly: true },
  { key: 'logs', label: '📄 操作ログ', adminOnly: true },
] as const;

type Section = (typeof ALL_SECTIONS)[number]['key'];

/**
 * 「🛠 管理」タブ(管理者・コーディネーター)。GAS版で管理者がスプレッドシートを直接編集・閲覧していた作業
 * (スタッフ台帳・「ＡＩプロンプト」シート・「日報」「事故報告」シート)と、Drive の CSV ログの確認の置き換え。
 * コーディネーターには「報告一覧」だけを出す。表示を切り替えると前の表示の中身は捨てるため、
 * AIプロンプトに保存していない変更があれば確かめる。
 */
export function AdminTab() {
  const confirm = useConfirmModal();
  const { user } = useSession();
  const isAdmin = isAdminRole(user.role);
  const SECTIONS = useMemo(() => ALL_SECTIONS.filter((s) => isAdmin || !s.adminOnly), [isAdmin]);
  const [section, setSection] = useState<Section>(() => SECTIONS[0]?.key ?? 'reports');
  const promptsDirty = useRef(false);
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const onPromptsDirtyChange = useCallback((dirty: boolean) => {
    promptsDirty.current = dirty;
  }, []);

  const switchTo = async (next: Section) => {
    if (next === section) return;
    if (section === 'prompts' && promptsDirty.current) {
      const ok = await confirm({
        title: '保存していないAIプロンプトの変更があります。捨てて移動しますか？',
        confirmLabel: '捨てて移動',
      });
      if (!ok) return;
      promptsDirty.current = false;
    }
    setSection(next);
    tabRefs.current[next]?.focus();
  };

  // 矢印キー・Home・End でタブを移る(WAI-ARIA のタブの操作)
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % SECTIONS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + SECTIONS.length) % SECTIONS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? SECTIONS.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = SECTIONS[target];
    if (next) void switchTo(next.key);
  };

  const panel = (
    <>
      {section === 'staff' ? <StaffAdminPanel /> : null}
      {section === 'reports' ? <ReportListPanel /> : null}
      {section === 'prompts' ? <PromptsPanel onDirtyChange={onPromptsDirtyChange} /> : null}
      {section === 'logs' ? <AuditLogPanel /> : null}
    </>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-800">🛠 管理</h1>
      {SECTIONS.length > 1 ? (
        <div role="tablist" aria-label="管理の項目" className="flex border-b border-gray-200">
          {SECTIONS.map((s, index) => {
            const selected = s.key === section;
            return (
              <button
                key={s.key}
                ref={(el) => {
                  tabRefs.current[s.key] = el;
                }}
                type="button"
                role="tab"
                id={`adminTab-${s.key}`}
                aria-selected={selected}
                aria-controls={selected ? `adminPanel-${s.key}` : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => void switchTo(s.key)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={`flex-1 min-h-12 py-3 text-sm font-bold border-b-2 transition-colors ${
                  selected ? 'text-blue-600 border-blue-600' : 'text-gray-600 border-transparent'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {SECTIONS.length > 1 ? (
        <div role="tabpanel" id={`adminPanel-${section}`} aria-labelledby={`adminTab-${section}`}>
          {panel}
        </div>
      ) : (
        <div id={`adminPanel-${section}`}>{panel}</div>
      )}
    </div>
  );
}
