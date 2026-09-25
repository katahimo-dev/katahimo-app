import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function Harness({ onClose, role }: { onClose?: () => void; role?: 'dialog' | 'alertdialog' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          開く
        </button>
      </main>
      <div id="toast" data-dialog-keep-interactive="">
        お知らせ
      </div>
      <Modal
        open={open}
        transition="none"
        role={role}
        labelledBy="title"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        className="fixed inset-0"
      >
        <h3 id="title">見出し</h3>
        <button type="button">キャンセル</button>
        <input aria-label="入力" />
        <button type="button" onClick={() => setOpen(false)}>
          閉じる
        </button>
      </Modal>
    </>
  );
}

describe('useDialogA11y(Modal)', () => {
  it('開くとダイアログにフォーカスし、後ろを inert にする。閉じると元に戻す', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '開く' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: '見出し' });
    expect(document.activeElement).toBe(dialog);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
    // お知らせは押せるままにする
    expect(document.getElementById('toast')?.hasAttribute('inert')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('Escape で onClose を呼ぶ', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab / Shift+Tab でダイアログの外へ出ない', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    const first = screen.getByRole('button', { name: 'キャンセル' });
    const last = screen.getByRole('button', { name: '閉じる' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('alertdialog は中の最初のボタンにフォーカスする', () => {
    render(<Harness role="alertdialog" />);
    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'キャンセル' }));
  });

  it('重ねて開いたときは、いちばん手前のダイアログだけが Escape に反応し、後ろのダイアログは inert', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    function Nested() {
      const [inner, setInner] = useState(false);
      return (
        <>
          <Modal open transition="none" onClose={outerClose} className="outer" labelledBy="o">
            <h3 id="o">外</h3>
            <button type="button" onClick={() => setInner(true)}>
              重ねる
            </button>
          </Modal>
          <Modal
            open={inner}
            transition="none"
            onClose={() => {
              innerClose();
              setInner(false);
            }}
            className="inner"
            labelledBy="i"
          >
            <h3 id="i">内</h3>
          </Modal>
        </>
      );
    }
    render(<Nested />);
    fireEvent.click(screen.getByRole('button', { name: '重ねる' }));
    const outer = document.querySelector('.outer');
    expect(outer?.hasAttribute('inert')).toBe(true);

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
    expect(outer?.hasAttribute('inert')).toBe(false);
  });
});
