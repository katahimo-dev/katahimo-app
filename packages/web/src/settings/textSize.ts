export type TextSize = 'small' | 'medium' | 'large';

const STORAGE_KEY = 'app_text_size';

/** GAS版index.htmlのwindow.onload「Restore Font Size」と同じデフォルト('small')。 */
export function getStoredTextSize(): TextSize {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'medium' || value === 'large' ? value : 'small';
}

/** GAS版index.htmlのapplyTextSizeと同じ(html[data-text-size]属性+localStorage)。 */
export function applyTextSize(size: TextSize): void {
  document.documentElement.setAttribute('data-text-size', size);
  localStorage.setItem(STORAGE_KEY, size);
}
