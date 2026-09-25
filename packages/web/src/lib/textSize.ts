import { getBrowserStorage, type KeyValueStorage, readStorage, STORAGE_KEYS, writeStorage } from './storage';

/**
 * 文字の大きさ(GAS版 TEXT_SIZE_ORDER / TEXT_SIZE_LABELS / normalizeTextSize_ / applyTextSize と同じ)。
 * 保存値は 'normal' / 'large' / 'xlarge' の3段階。以前の 'small' / 'medium' など
 * 知らない値が保存されている場合は 'normal' として扱う(GAS版の互換処理と同じ)。
 * 実際の拡大は <html data-text-size> に応じてルートのfont-sizeを変えるCSS(styles/index.css)で行う。
 */
export const TEXT_SIZE_ORDER = ['normal', 'large', 'xlarge'] as const;
export type TextSize = (typeof TEXT_SIZE_ORDER)[number];

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  normal: 'ふつう',
  large: '大きい',
  xlarge: 'とても大きい',
};

export function normalizeTextSize(size: string | null | undefined): TextSize {
  return (TEXT_SIZE_ORDER as readonly string[]).includes(size ?? '') ? (size as TextSize) : 'normal';
}

/** ヘッダーの「Aa 文字」ボタン用。ふつう→大きい→とても大きい→ふつう と回る。 */
export function nextTextSize(current: TextSize): TextSize {
  const index = TEXT_SIZE_ORDER.indexOf(current);
  return TEXT_SIZE_ORDER[(index + 1) % TEXT_SIZE_ORDER.length] ?? 'normal';
}

export function readStoredTextSize(storage: KeyValueStorage | null = getBrowserStorage()): TextSize {
  return normalizeTextSize(readStorage(STORAGE_KEYS.textSize, storage));
}

/**
 * <html data-text-size> を書きかえ、正規化した値を保存する(GAS版 applyTextSize と同じく、
 * 古い値が保存されていた場合もここで 'normal' に置きかわる)。
 */
export function applyTextSizeToDocument(
  size: string | null | undefined,
  root: HTMLElement = document.documentElement,
  storage: KeyValueStorage | null = getBrowserStorage(),
): TextSize {
  const normalized = normalizeTextSize(size);
  root.setAttribute('data-text-size', normalized);
  writeStorage(STORAGE_KEYS.textSize, normalized, storage);
  return normalized;
}
