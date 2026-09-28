import { type KeyboardEvent, type ReactNode, useRef } from 'react';

export interface SectionTab<K extends string> {
  key: K;
  label: string;
}

/**
 * 管理タブの中の切り替え(WAI-ARIA のタブ。矢印キー・Home・End で移る)。狭い画面では横にスクロールし、見出しを折り返さない。
 * 中身は呼び出し側が `role="tabpanel"`・`id={`${idPrefix}Panel-${key}`}`・`aria-labelledby={`${idPrefix}Tab-${key}`}` で置く
 * (`SectionTabPanel`)。variant は、上の段が underline、その下の段が pill。
 */
export function SectionTabs<K extends string>({
  tabs,
  selected,
  onSelect,
  label,
  idPrefix,
  variant = 'underline',
}: {
  tabs: readonly SectionTab<K>[];
  selected: K;
  /** 切り替え。確かめて移らなかったら false(または false の Promise)を返す(フォーカスを動かさない)。 */
  onSelect: (key: K) => unknown;
  label: string;
  idPrefix: string;
  variant?: 'underline' | 'pill';
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});

  const select = async (key: K) => {
    if (key === selected) return;
    const moved = await onSelect(key);
    if (moved !== false) refs.current[key]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target];
    if (next) void select(next.key);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={
        variant === 'underline'
          ? 'flex overflow-x-auto border-b border-gray-200 -mx-1 px-1'
          : 'flex flex-wrap gap-1'
      }
    >
      {tabs.map((t, index) => {
        const isSelected = t.key === selected;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[t.key] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}Tab-${t.key}`}
            aria-selected={isSelected}
            aria-controls={isSelected ? `${idPrefix}Panel-${t.key}` : undefined}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => void select(t.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={
              variant === 'underline'
                ? `shrink-0 whitespace-nowrap min-h-10 px-3 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
                    isSelected
                      ? 'text-blue-600 border-blue-600'
                      : 'text-gray-600 border-transparent hover:text-gray-800'
                  }`
                : `whitespace-nowrap min-h-8 px-3 py-1 rounded-full text-xs font-bold ${
                    isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** SectionTabs の中身の枠。 */
export function SectionTabPanel<K extends string>({
  idPrefix,
  tabKey,
  children,
}: {
  idPrefix: string;
  tabKey: K;
  children: ReactNode;
}) {
  return (
    <div role="tabpanel" id={`${idPrefix}Panel-${tabKey}`} aria-labelledby={`${idPrefix}Tab-${tabKey}`}>
      {children}
    </div>
  );
}
