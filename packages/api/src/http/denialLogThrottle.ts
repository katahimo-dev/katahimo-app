import { rateLimitIpSubject } from '@katahimo/core/domain';

/**
 * ログインしていない要求の拒否の操作ログ(WARN `<action>.access_denied`・`auth.session.auto_login_failed`)を、送信元IPごとに
 * 間引く(このインスタンスの中だけ)。認証の無い要求は誰でも送れるため、毎回書くと操作ログ(DB)を溢れさせられる。
 * 応答(401)は変えない。窓の中で上限を超えた分は書かず、次の窓の最初の1件の details.suppressed に件数を残す
 * (その後に要求が来なければ、間引いた件数は残らない)。キーは rateLimitIpSubject(IPv6 は /64)。
 */
export interface DenialLogThrottleOptions {
  /** 1つの送信元が1つの窓で書ける件数。 */
  limit: number;
  windowMs: number;
  /** 覚える送信元の数(超えたら最も前に使った送信元から忘れる)。 */
  maxKeys: number;
}

export const DEFAULT_DENIAL_LOG_THROTTLE: DenialLogThrottleOptions = {
  limit: 5,
  windowMs: 10 * 60 * 1000,
  maxKeys: 10_000,
};

interface Entry {
  windowStart: number;
  count: number;
  suppressed: number;
}

/** 書くなら前の窓で書かなかった件数、書かないなら null。 */
export type DenialLogDecision = { suppressed: number } | null;

export class DenialLogThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly options: DenialLogThrottleOptions = DEFAULT_DENIAL_LOG_THROTTLE,
    private readonly now: () => number = Date.now,
  ) {}

  take(ip: string | null | undefined): DenialLogDecision {
    const key = ip ? rateLimitIpSubject(ip) : 'unknown';
    const now = this.now();
    const entry = this.entries.get(key);
    // 使った順に並べ直す(Map は入れた順。先頭が最も前に使った送信元)
    if (entry) this.entries.delete(key);
    if (!entry || now - entry.windowStart >= this.options.windowMs) {
      this.entries.set(key, { windowStart: now, count: 1, suppressed: 0 });
      this.evict();
      return { suppressed: entry?.suppressed ?? 0 };
    }
    this.entries.set(key, entry);
    if (entry.count < this.options.limit) {
      entry.count += 1;
      return { suppressed: 0 };
    }
    entry.suppressed += 1;
    return null;
  }

  /** 覚えている送信元の数(テスト用)。 */
  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    while (this.entries.size > this.options.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}
