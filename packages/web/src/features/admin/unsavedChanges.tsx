import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';
import { useConfirmModal } from '../../ui/confirm';
import { useUnsavedChangesWarning } from './useUnsavedChangesWarning';

interface UnsavedChangesRegistry {
  set: (id: string, dirty: boolean) => void;
  any: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesRegistry | null>(null);

/**
 * 管理タブの中の「保存していない変更」の置き場。表示を切り替えると前の表示の中身は捨てるため、切り替える前に
 * useConfirmLeave で確かめる(AIプロンプト・APIキー・通知先の入力)。
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyIds = useRef(new Set<string>());
  const registry = useMemo<UnsavedChangesRegistry>(
    () => ({
      set: (id, dirty) => {
        if (dirty) dirtyIds.current.add(id);
        else dirtyIds.current.delete(id);
      },
      any: () => dirtyIds.current.size > 0,
    }),
    [],
  );
  return <UnsavedChangesContext.Provider value={registry}>{children}</UnsavedChangesContext.Provider>;
}

/** この画面に保存していない変更があるかを知らせる(外れたら消す。ページを閉じる前のブラウザの確認も出す)。 */
export function useReportUnsavedChanges(dirty: boolean) {
  const registry = useContext(UnsavedChangesContext);
  const id = useId();
  useUnsavedChangesWarning(dirty);
  useEffect(() => {
    registry?.set(id, dirty);
    return () => registry?.set(id, false);
  }, [registry, id, dirty]);
}

/** 保存していない変更があれば捨ててよいか確かめる。移ってよければ true。 */
export function useConfirmLeave() {
  const registry = useContext(UnsavedChangesContext);
  const confirm = useConfirmModal();
  return useCallback(async () => {
    if (!registry?.any()) return true;
    return confirm({
      title: '保存していない変更があります。捨てて移動しますか？',
      confirmLabel: '捨てて移動',
    });
  }, [registry, confirm]);
}
