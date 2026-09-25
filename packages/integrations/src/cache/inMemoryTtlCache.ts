import type { CachePort } from '@katahimo/core/ports';

export interface InMemoryTtlCacheOptions {
  /** 保持する最大件数。超えたら最も長く使われていないものから捨てる。 */
  maxEntries: number;
  /** テスト用の時計。 */
  now?: () => number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * プロセス内のTTL付きLRUキャッシュ(CachePortの実装)。
 *
 * GAS版 CacheService と違い、Cloud Runのインスタンス間では共有されない(インスタンスごとに
 * 別々に計算・保持する)。インスタンス間で共有したくなったらMemorystore実装に差し替える。
 * 呼び出し側が取り出した値を書き換えてもキャッシュ内容が変わらないよう、出し入れの度に複製する。
 */
export class InMemoryTtlCache implements CachePort {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(private readonly options: InMemoryTtlCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry); // 最近使ったものを末尾へ(Mapの挿入順をLRU順として使う)
    return structuredClone(entry.value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value: structuredClone(value), expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
