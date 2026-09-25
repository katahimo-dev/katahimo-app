import { useCallback, useState } from 'react';

/**
 * 「どのお客様のダイアログを開いているか」。閉じてもフェードアウトの間は中身を出したままにするため、
 * 開いているか(isOpen)と対象(target)を分けて持つ(閉じたあとも target は次に開くまで残る)。
 */
export function useModalTarget<T>() {
  const [state, setState] = useState<{ isOpen: boolean; target: T | null }>({ isOpen: false, target: null });
  const open = useCallback((target: T) => setState({ isOpen: true, target }), []);
  const close = useCallback(() => setState((prev) => ({ ...prev, isOpen: false })), []);
  return { isOpen: state.isOpen, target: state.target, open, close };
}
