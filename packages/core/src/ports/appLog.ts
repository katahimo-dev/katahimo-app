/** アプリ操作ログのレベル(GAS版Logging.jsの logToBuffer と同じ区分)。 */
export type AppLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';

export interface AppLogEntry {
  /** ログイン前のイベント(テナント未特定のログイン失敗等)はnull。 */
  tenantId: string | null;
  level: AppLogLevel;
  /** 操作の識別子。例: 'auth.login_failed'、'attendance.day.update'。 */
  action: string;
  /** 操作したスタッフ。 */
  actorStaffId?: string | null;
  /** 管理者が他スタッフのデータを操作・閲覧した場合の対象スタッフ。 */
  targetStaffId?: string | null;
  /** 付加情報。個人情報・本文は入れない(ID・件数・理由コード程度に留める)。 */
  details?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * アプリ操作ログ・監査ログ(GAS版 logToBuffer → Drive CSV に相当)。
 *
 * 規約(GAS版と同じ): WARN/ERROR(アクセス拒否・失敗)は常に記録する。読み取り系の成功は、
 * 実コストがある操作(Maps API呼び出し等)か、管理者が他スタッフのデータを扱った場合だけ記録する。
 * 記録の失敗で本来の処理を失敗させないため、実装は例外を投げずに握りつぶす(stderrには出す)。
 */
export interface AppLogPort {
  write(entry: AppLogEntry): Promise<void>;
}
