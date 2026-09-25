import type { ReactNode } from 'react';

/**
 * 出勤簿タブのダイアログの外側(暗い背景)。GAS版の出勤簿のダイアログはフェードせず `hidden` を
 * 付け外しするだけなので、開いている間だけ描く。className はGAS版の外側divのクラスから `hidden` を除いたもの。
 */
export function Dialog({
  open,
  className,
  labelledBy,
  children,
}: {
  open: boolean;
  className: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={className}>
      {children}
    </div>
  );
}
