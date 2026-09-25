import type { ReactNode } from 'react';
import { useFadeTransition } from './useFadeTransition';

interface FadeModalProps {
  open: boolean;
  /**
   * 外側(暗い背景)のクラス。GAS版の該当ダイアログの外側divのクラスから `hidden` と `opacity-0` を
   * 除いたものをそのまま渡す(例: 'fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center
   * justify-center transition-opacity')。
   */
  className: string;
  /**
   * 閉じている間も中身を残す(GAS版は閉じてもDOMが残るため、入力途中の値や<details>の開閉が
   * 次に開いたときも残る)。既定は false(閉じたら中身を捨てる)。
   */
  keepMounted?: boolean;
  children: ReactNode;
  labelledBy?: string;
}

/** GAS版の「hidden + opacity-0 を付け外しする」ダイアログの外側。中身の見た目は呼び出し側で書く。 */
export function FadeModal({ open, className, keepMounted = false, children, labelledBy }: FadeModalProps) {
  const { mounted, shown } = useFadeTransition(open);
  if (!mounted && !keepMounted) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={`${className}${mounted ? '' : ' hidden'}${shown ? '' : ' opacity-0'}`}
    >
      {children}
    </div>
  );
}
