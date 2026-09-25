import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import {
  applyTextSizeToDocument,
  nextTextSize,
  readStoredTextSize,
  TEXT_SIZE_LABELS,
  type TextSize,
} from '../lib/textSize';
import { showToast } from '../ui/toast';

interface TextSizeContextValue {
  textSize: TextSize;
  /** 設定の「文字の大きさ」ラジオ(GAS版 applyTextSize)。選んだ時点ですぐ反映・保存する。 */
  setTextSize: (size: TextSize) => void;
  /** ヘッダーの「Aa」ボタン(GAS版 cycleTextSize)。次の大きさにしてお知らせを出す。 */
  cycleTextSize: () => void;
}

const TextSizeContext = createContext<TextSizeContextValue | null>(null);

/**
 * 文字の大きさ。初期値の反映(<html data-text-size>)は描画前に main.tsx で済ませている
 * (一瞬ふつうの大きさで表示されてから大きくなるのを防ぐため)。
 */
export function TextSizeProvider({ children }: { children: ReactNode }) {
  const [textSize, setState] = useState<TextSize>(() => readStoredTextSize());

  const setTextSize = useCallback((size: TextSize) => {
    setState(applyTextSizeToDocument(size));
  }, []);

  const cycleTextSize = useCallback(() => {
    // GAS版と同じく、保存されている値を基準に次へ進める
    const next = nextTextSize(readStoredTextSize());
    setState(applyTextSizeToDocument(next));
    showToast(`文字の大きさ: ${TEXT_SIZE_LABELS[next]}`);
  }, []);

  const value = useMemo(
    () => ({ textSize, setTextSize, cycleTextSize }),
    [textSize, setTextSize, cycleTextSize],
  );
  return <TextSizeContext value={value}>{children}</TextSizeContext>;
}

export function useTextSize(): TextSizeContextValue {
  const value = useContext(TextSizeContext);
  if (!value) throw new Error('useTextSize は TextSizeProvider の中で使ってください');
  return value;
}
