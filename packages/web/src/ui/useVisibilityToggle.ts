import { useCallback, useState } from 'react';

/** パスワード・APIキー欄の表示/非表示の切り替え(GAS版の「👁 見る」「表示」ボタン)。 */
export function useVisibilityToggle(initial = false) {
  const [visible, setVisible] = useState(initial);
  const toggle = useCallback(() => setVisible((v) => !v), []);
  const reset = useCallback(() => setVisible(false), []);
  return { visible, toggle, reset };
}
