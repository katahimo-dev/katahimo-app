import { type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { useConfirmModal } from '../../ui/confirm';
import { AuditLogPanel } from './logs/AuditLogPanel';
import { PromptsPanel } from './prompts/PromptsPanel';
import { StaffAdminPanel } from './staff/StaffAdminPanel';

const SECTIONS = [
  { key: 'staff', label: '👤 スタッフ' },
  { key: 'prompts', label: '🤖 AIプロンプト' },
  { key: 'logs', label: '📄 操作ログ' },
] as const;

type Section = (typeof SECTIONS)[number]['key'];

/**
 * 「🛠 管理」タブ(管理者だけ)。GAS版で管理者がスプレッドシートを直接編集していた作業(スタッフ台帳・
 * 「ＡＩプロンプト」シート)と、Drive の CSV ログの確認の置き換え。表示を切り替えると前の表示の中身は捨てるため、
 * AIプロンプトに保存していない変更があれば確かめる。
 */
export function AdminTab() {
  const confirm = useConfirmModal();
  const [section, setSection] = useState<Section>('staff');
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

  // 矢印キーでタブを移る(WAI-ARIA のタブの操作)
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = SECTIONS[(index + delta + SECTIONS.length) % SECTIONS.length];
    if (next) void switchTo(next.key);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-800">🛠 管理</h1>
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
              aria-controls={`adminPanel-${s.key}`}
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
      <div role="tabpanel" id={`adminPanel-${section}`} aria-labelledby={`adminTab-${section}`}>
        {section === 'staff' ? <StaffAdminPanel /> : null}
        {section === 'prompts' ? <PromptsPanel onDirtyChange={onPromptsDirtyChange} /> : null}
        {section === 'logs' ? <AuditLogPanel /> : null}
      </div>
    </div>
  );
}
