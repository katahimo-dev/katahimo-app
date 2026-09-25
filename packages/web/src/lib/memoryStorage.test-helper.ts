import type { KeyValueStorage } from './storage';

/** テスト用のメモリ上のStorage。 */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  snapshot: () => Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    snapshot: () => Object.fromEntries(map),
  };
}
