import { type ReactNode, type RefObject, useRef } from 'react';
import { useDialogA11y } from './useDialogA11y';
import { useFadeTransition } from './useFadeTransition';

export interface ModalRenderState {
  /** 不透明にしているか(false = GAS版の opacity-0。中身の scale / translate の出し分けに使う) */
  shown: boolean;
}

export interface ModalProps {
  open: boolean;
  /**
   * 外側(暗い背景)のクラス。GAS版の該当ダイアログの外側divのクラスから `hidden` と `opacity-0` を
   * 除いたものをそのまま渡す(例: 'fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center
   * justify-center transition-opacity')。
   */
  className: string;
  /**
   * 開き方。'fade'(既定): GAS版の「hidden を外して10ms後に opacity-0 を外す / 閉じるときは300msかけて消す」。
   * 'none': GAS版の出勤簿のダイアログのように hidden を付け外しするだけ(開いている間だけ描く)。
   */
  transition?: 'fade' | 'none';
  /**
   * 閉じている間も中身を残す(GAS版は閉じてもDOMが残るため、入力途中の値や<details>の開閉が
   * 次に開いたときも残る)。既定は false(閉じたら中身を捨てる)。transition='fade' のときだけ使う。
   */
  keepMounted?: boolean;
  /** 'alertdialog' は確認ダイアログ(開いたときに中の最初のボタンにフォーカスする) */
  role?: 'dialog' | 'alertdialog';
  labelledBy?: string;
  id?: string;
  /** Escape キーで閉じる(GAS版の × と同じ動きで閉じてよいダイアログだけ渡す) */
  onClose?: () => void;
  /** 開いたときにフォーカスする要素(既定はダイアログ自身) */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode | ((state: ModalRenderState) => ReactNode);
}

/**
 * ダイアログの外側(暗い背景)。アプリのダイアログはすべてこれを使う(中身の見た目は呼び出し側で書く)。
 * フォーカスの移動・閉じ込め・Escape・後ろの画面の inert は useDialogA11y が行う(見た目は変えない)。
 */
export function Modal({
  open,
  className,
  transition = 'fade',
  keepMounted = false,
  role = 'dialog',
  labelledBy,
  id,
  onClose,
  initialFocusRef,
  children,
}: ModalProps) {
  const fade = useFadeTransition(open);
  const { mounted, shown } = transition === 'fade' ? fade : { mounted: open, shown: open };
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, open && mounted, onClose, { initialFocusRef });

  if (!mounted && !(keepMounted && transition === 'fade')) return null;
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role は dialog / alertdialog のどちらか(どちらも aria-modal を持てる)
    <div
      ref={ref}
      id={id}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={`${className}${mounted ? '' : ' hidden'}${shown || transition === 'none' ? '' : ' opacity-0'} outline-none`}
    >
      {typeof children === 'function' ? children({ shown }) : children}
    </div>
  );
}

/**
 * 以前の名前(GAS版のフェードするダイアログ)。中身は Modal と同じ。
 * @deprecated Modal を使う
 */
export const FadeModal = Modal;
