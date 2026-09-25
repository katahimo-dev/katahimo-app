/**
 * TTL付きの共有キャッシュ(GAS版 CacheService.getScriptCache() に相当)。
 *
 * 現在の実装はAPIプロセス内のTTL付きLRU(packages/integrations/src/cache)のため、Cloud Runで
 * インスタンスが複数立つとインスタンス間では共有されない。Memorystore等へ差し替える場合も
 * このインターフェースのまま実装だけを替える。値はJSONとして表現できるものに限る。
 */
export interface CachePort {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}
