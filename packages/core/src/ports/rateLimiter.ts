import type { RateLimitDecision, RateLimitRule } from '../domain/rateLimit';

/**
 * レート制限・一時ロックのポート。Cloud Run の複数インスタンスで共有できるよう、実装は Postgres
 * (@katahimo/db の DrizzleRateLimiter、rate_limit_buckets テーブル)に置く。判定の計算は
 * domain/rateLimit の consumeRateLimit / peekRateLimit で行い、実装は記録の読み書きを原子的に行う
 * (同時に来たリクエストが同じ回数を読んで上限を超えないよう、行ロックの中で数える)。
 *
 * key は規則ごとの識別子(IPアドレス、`テナントslug:ログインID`、スタッフID等)。実装はこれを
 * 平文で保存せず、秘密鍵付きハッシュにしてから保存すること。
 */
export interface RateLimiterPort {
  /** 1回分を記録し、その回を許可するかを返す。 */
  consume(rule: RateLimitRule, key: string, now: Date): Promise<RateLimitDecision>;
  /** 記録せずに、次の1回が許可されるかを返す。 */
  peek(rule: RateLimitRule, key: string, now: Date): Promise<RateLimitDecision>;
  /** 記録を消す(ログイン成功時に失敗回数を戻す等)。 */
  reset(rule: RateLimitRule, key: string): Promise<void>;
}
