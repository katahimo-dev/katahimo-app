/**
 * ワーカーの保守ジョブ(保存期間を過ぎた行の削除・操作ログのパーティション)。
 */
export interface RetentionCutoffs {
  /** 失効・期限切れからこの日時より前のセッション。 */
  sessionsBefore: Date;
  /** 完了(done)がこの日時より前の outbox。 */
  outboxDoneBefore: Date;
  /** 失敗(failed / dead)がこの日時より前の outbox。 */
  outboxFailedBefore: Date;
  /** 期限がこの日時より前のパスワード再設定コード。 */
  passwordResetCodesBefore: Date;
  /** 作成がこの日時より前のマッチングの候補。 */
  matchingCandidatesBefore: Date;
}

/** テナントの中(RLS)で消す。消した件数を表ごとに返す。 */
export interface TenantRetentionRepository {
  purge(cutoffs: RetentionCutoffs): Promise<Record<string, number>>;
}

/** テナントを横断する保守(platform スキーマ・パーティション)。 */
export interface PlatformMaintenancePort {
  purgeRateLimitBuckets(updatedBefore: Date): Promise<number>;
  ensureAppLogPartitions(monthsAhead: number): Promise<number>;
  dropAppLogPartitions(retainMonths: number): Promise<number>;
}
