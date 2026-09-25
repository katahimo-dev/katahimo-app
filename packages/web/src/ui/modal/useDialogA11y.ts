import { type RefObject, useEffect, useRef } from 'react';

/**
 * ダイアログのキーボード・支援技術まわり(見た目は変えない)。
 *
 * - 開いたとき: `initialFocusRef` の要素(無ければダイアログ自身。`role="alertdialog"` なら中の最初のボタン)に
 *   フォーカスを移す(画面は動かさない)。
 * - 開いている間: Tab / Shift+Tab でダイアログの外へ出ない。Escape で `onClose`(渡したときだけ。GAS版の
 *   × と同じ動きで閉じてよいダイアログだけ渡す)。いちばん手前のダイアログだけが反応する。
 * - 開いている間: ダイアログの外(兄弟の要素と、その祖先の兄弟)に `inert` を付け、指・キーボード・読み上げが
 *   後ろの画面に届かないようにする。`data-dialog-keep-interactive` を付けた要素(お知らせ)は除く。
 * - 閉じたとき: 開く前にフォーカスがあった要素に戻す。
 */
export interface DialogA11yOptions {
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/** 開いているダイアログ(後ろほど手前) */
const stack: HTMLElement[] = [];
/** このモジュールが inert を付けた要素 */
let inerted: HTMLElement[] = [];

const KEEP_INTERACTIVE_ATTR = 'data-dialog-keep-interactive';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 見えているか(hidden クラスなど display:none の中は見えない)。調べられない環境では見えているとする */
function isVisible(el: HTMLElement): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

/** 見えていてフォーカスできる要素 */
export function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && isVisible(el),
  );
}

function releaseInert() {
  for (const el of inerted) el.removeAttribute('inert');
  inerted = [];
}

/** いちばん手前のダイアログ以外を inert にする(開閉のたびに付け直す) */
function applyInert() {
  releaseInert();
  const top = stack.at(-1);
  if (!top) return;
  let node: HTMLElement = top;
  while (node.parentElement && node !== document.body) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('inert') || sibling.hasAttribute(KEEP_INTERACTIVE_ATTR)) continue;
      if (sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE') continue;
      sibling.setAttribute('inert', '');
      inerted.push(sibling);
    }
    node = node.parentElement;
  }
}

function initialFocusTarget(dialog: HTMLElement, initialFocus?: HTMLElement | null): HTMLElement {
  if (initialFocus) return initialFocus;
  if (dialog.getAttribute('role') === 'alertdialog') {
    const button = focusableElements(dialog).find((el) => el.tagName === 'BUTTON');
    if (button) return button;
  }
  return dialog;
}

export function useDialogA11y(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose?: () => void,
  { initialFocusRef }: DialogA11yOptions = {},
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(dialog);
    applyInert();
    initialFocusTarget(dialog, initialFocusRef?.current).focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (stack.at(-1) !== dialog || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (!onCloseRef.current) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = focusableElements(dialog);
      const first = focusables[0];
      const last = focusables.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = stack.lastIndexOf(dialog);
      if (index >= 0) stack.splice(index, 1);
      applyInert();
      // フォーカスがダイアログの中(か、どこにも無い)ときだけ、開く前の場所に戻す
      const active = document.activeElement;
      const focusWasInside = !active || active === document.body || dialog.contains(active);
      if (focusWasInside && previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, ref, initialFocusRef]);
}
