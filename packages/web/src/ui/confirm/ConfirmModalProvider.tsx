import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal } from '../modal';

/**
 * GAS版 #confirmationModal(「前に保存した日報を、今の内容に書きかえますか？」)と同じ見た目の
 * 確認ダイアログ。`const ok = await confirm({ title, confirmLabel })` のように使う。
 */
export interface ConfirmModalOptions {
  title: string;
  /** 右の青いボタンの文言(GAS版の例: 「書きかえる」) */
  confirmLabel: string;
  /** 左の灰色のボタンの文言。既定は「キャンセル」 */
  cancelLabel?: string;
}

type ConfirmFn = (options: ConfirmModalOptions) => Promise<boolean>;

const ConfirmModalContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmModalOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmModalProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    // 前の確認が残っていたら「キャンセル」扱いで閉じる
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve };
      pendingRef.current = next;
      setPending(next);
      setOpen(true);
    });
  }, []);

  const settle = (ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setOpen(false);
  };

  useEffect(() => () => pendingRef.current?.resolve(false), []);

  return (
    <ConfirmModalContext value={confirm}>
      {children}
      <ConfirmModalView open={open} options={pending?.options ?? null} onSettle={settle} />
    </ConfirmModalContext>
  );
}

function ConfirmModalView({
  open,
  options,
  onSettle,
}: {
  open: boolean;
  options: ConfirmModalOptions | null;
  onSettle: (ok: boolean) => void;
}) {
  if (!options) return null;
  return (
    <Modal
      open={open}
      role="alertdialog"
      labelledBy="confirmModalTitle"
      // Escape は「キャンセル」と同じ
      onClose={() => onSettle(false)}
      className="fixed inset-0 bg-black bg-opacity-50 z-[70] flex items-center justify-center p-4 transition-opacity duration-300"
    >
      {({ shown }) => (
        <div
          className={`bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 transform ${
            shown ? 'scale-100' : 'scale-95'
          } transition-transform duration-300`}
        >
          <h3 id="confirmModalTitle" className="font-bold text-lg text-gray-800 mb-2">
            {options.title}
          </h3>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onSettle(false)}
              className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl transition-colors"
            >
              {options.cancelLabel ?? 'キャンセル'}
            </button>
            <button
              type="button"
              onClick={() => onSettle(true)}
              className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl transition-colors"
            >
              {options.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function useConfirmModal(): ConfirmFn {
  const confirm = useContext(ConfirmModalContext);
  if (!confirm) throw new Error('useConfirmModal は ConfirmModalProvider の中で使ってください');
  return confirm;
}
