import type { ActorType, AppLogLevel } from '../domain/model';

export interface AppLogEntry {
  /** ログイン前のイベント(テナント未特定のログイン失敗等)は null。 */
  tenantId: string | null;
  level: AppLogLevel;
  /** 操作の識別子。例: 'auth.login.failed'、'attendance.day.update'。 */
  action: string;
  /** 操作したスタッフ(actor_type = 'staff')。 */
  actorStaffId?: string | null;
  /** スタッフ以外の操作者(ジョブ = system 等)。actorStaffId が無ければ system / anonymous。 */
  actorType?: Exclude<ActorType, 'staff'>;
  /** 管理者が他スタッフのデータを操作・閲覧した場合の対象スタッフ(target_type = 'staff')。 */
  targetStaffId?: string | null;
  /** 付加情報。個人情報・本文は入れない(ID・件数・理由コード程度に留める)。 */
  details?: Record<string, unknown> | undefined;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * アプリ操作ログ・監査ログ(app_logs。GAS版 logToBuffer → Drive CSV に相当)。
 * 規約: WARN/ERROR(拒否・失敗)と書き込みは常に記録する。読み取り系の成功は、実コストがある操作
 * (Maps API)か管理者が他スタッフのデータを扱った場合だけ記録する。記録の失敗で本来の処理を
 * 失敗させないため、実装は例外を投げない(標準エラーには出す)。UoW のトランザクションとは独立に書く
 * (処理が失敗・ロールバックしても記録は残る)。
 */
export interface AppLogPort {
  write(entry: AppLogEntry): Promise<void>;
}

/**
 * 一覧の位置(並び順 created_at DESC, id DESC のキー)。at は DB の時刻の文字列そのもの(マイクロ秒まで保つ。
 * Date にするとミリ秒に丸まり、同じミリ秒の行を読み飛ばすため)。
 */
export interface AppLogPosition {
  at: string;
  id: string;
}

/** 管理者の操作ログの閲覧の条件。期間は [from, to)。 */
export interface AppLogFilter {
  from: Date;
  to: Date;
  level?: AppLogLevel | undefined;
  /** 操作者または対象がこのスタッフ。 */
  staffId?: string | undefined;
  /** 操作コードの前方一致。 */
  actionPrefix?: string | undefined;
}

export interface AppLogRecord {
  id: string;
  createdAt: Date;
  position: AppLogPosition;
  level: AppLogLevel;
  action: string;
  actorType: ActorType;
  actorStaffId: string | null;
  targetStaffId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/**
 * 操作ログの読み取り(UoW のテナントのものだけ。RLS でも同じ。テナントの無い行 = ログイン前の記録は読めない)。
 * 並びは新しい順。after を渡すとその位置より古いものから読む。
 */
export interface AppLogReadRepository {
  list(filter: AppLogFilter, page: { after: AppLogPosition | null; limit: number }): Promise<AppLogRecord[]>;
}
