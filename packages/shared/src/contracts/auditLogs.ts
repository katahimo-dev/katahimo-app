import { z } from 'zod';
import { businessDateSchema, idSchema } from './common';

/** 操作ログのレベル(app_logs.level)。 */
export const APP_LOG_LEVELS = ['INFO', 'WARN', 'ERROR', 'SECURITY'] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];
export const appLogLevelSchema = z.enum(APP_LOG_LEVELS);

/** 操作者の種類(app_logs.actor_type)。 */
export const ACTOR_TYPES = ['staff', 'system', 'operator', 'anonymous'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** 期間を指定しないときに見る日数(今日を含む)。 */
export const AUDIT_LOG_DEFAULT_RANGE_DAYS = 7;
/** 1回に指定できる期間の上限(日数。今日を含む)。 */
export const AUDIT_LOG_MAX_RANGE_DAYS = 93;
/** 1ページの件数の上限。 */
export const AUDIT_LOG_MAX_PAGE_SIZE = 200;

/**
 * GET /api/admin/audit-logs・GET /api/admin/audit-logs.csv の条件。
 * - from / to: テナントのタイムゾーンの業務日(両端を含む)。省略時は今日までの7日間。期間は93日まで。
 * - staffId: 操作者または対象がこのスタッフのもの
 * - action: 操作コードの前方一致(例: 'staff.admin' / 'auth.')
 * - cursor: 前のページの nextCursor(一覧だけ。CSV は条件に合う全件)
 */
export const auditLogQuerySchema = z
  .object({
    from: businessDateSchema.optional(),
    to: businessDateSchema.optional(),
    level: appLogLevelSchema.optional(),
    staffId: idSchema.optional(),
    action: z
      .string()
      .trim()
      .max(100, '操作の指定が長すぎます')
      .regex(/^[a-z0-9_.]*$/, '操作は英小文字・数字・「_」「.」で指定してください')
      .optional()
      .transform((v) => v || undefined),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_LOG_MAX_PAGE_SIZE).default(50),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '期間の開始日は終了日より前にしてください',
    path: ['from'],
  });
export type AuditLogQuery = z.input<typeof auditLogQuerySchema>;

/** 操作ログ1件。 */
export const auditLogEntrySchema = z.object({
  id: idSchema,
  /** ISO8601(UTC)。画面ではテナントのタイムゾーンで表示する。 */
  createdAt: z.string(),
  level: appLogLevelSchema,
  action: z.string(),
  actorType: z.enum(ACTOR_TYPES),
  actorStaffId: idSchema.nullable(),
  /** 操作者の氏名(削除されたスタッフは null)。 */
  actorName: z.string().nullable(),
  targetStaffId: idSchema.nullable(),
  targetName: z.string().nullable(),
  /** ID・件数・理由コード等(個人情報は入っていない)。 */
  details: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** GET /api/admin/audit-logs(新しい順)。 */
export const auditLogListResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  /** 次のページの cursor(最後のページは null)。 */
  nextCursor: z.string().nullable(),
  /** 実際に使った期間(省略時の既定を埋めたもの)。 */
  range: z.object({ from: businessDateSchema, to: businessDateSchema }),
  /** テナントのタイムゾーン(表示用)。 */
  timeZone: z.string(),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

// ── 表示(画面と CSV で共有) ─────────────────────────────────

export const APP_LOG_LEVEL_LABELS: Record<AppLogLevel, string> = {
  INFO: '情報',
  WARN: '注意',
  ERROR: 'エラー',
  SECURITY: 'セキュリティ',
};

export const ACTOR_TYPE_LABELS: Record<ActorType, string> = {
  staff: 'スタッフ',
  system: 'システム',
  operator: '運用者',
  anonymous: 'ログイン前',
};

/** 画面の「操作の種類」の絞り込み(操作コードの前方一致)。 */
export const AUDIT_LOG_CATEGORIES = [
  { prefix: 'auth.', label: 'ログイン・パスワード' },
  { prefix: 'staff.', label: 'スタッフ管理' },
  { prefix: 'settings.', label: '設定・AIプロンプト' },
  { prefix: 'audit_log.', label: '操作ログの閲覧' },
  { prefix: 'attendance.', label: '出勤簿' },
  { prefix: 'schedule.', label: '予定・ルート' },
  { prefix: 'report.', label: '日報・事故報告' },
  { prefix: 'receipt.', label: '領収書' },
  { prefix: 'customer', label: 'お客様・顧客CSV' },
  { prefix: 'ai.', label: 'AI' },
  { prefix: 'notification.', label: 'Google Chatへの通知' },
  { prefix: 'push.', label: 'スマホへの通知' },
  { prefix: 'calendar.', label: 'カレンダー' },
  { prefix: 'tenant.', label: '法人の設定(運用担当者)' },
  { prefix: 'integration.', label: '外部システムとの連携' },
  { prefix: 'mirror.', label: 'スプレッドシートへの反映' },
  { prefix: 'outbox.', label: '外部への送信' },
  { prefix: 'maintenance.', label: '保守' },
  { prefix: 'rate_limit.', label: '回数の上限' },
] as const;

/** 操作コード → 表示名(無いものは操作コードのまま出す)。 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login.succeeded': 'ログイン',
  'auth.login.failed': 'ログインの失敗',
  'auth.login.locked': 'ロック中のログイン',
  'auth.login.lockout_started': 'ログインのロック開始',
  'auth.logout': 'ログアウト',
  'auth.session.auto_login': '自動ログイン',
  'auth.session.auto_login_failed': '自動ログインの失敗',
  'auth.password_change.succeeded': 'パスワードの変更',
  'auth.password_change.failed': 'パスワードの変更の失敗',
  'auth.password_reset.requested': 'パスワード再設定の番号を送信',
  'auth.password_reset.request_rejected': 'パスワード再設定の番号の送信を断った',
  'auth.password_reset.completed': 'パスワードの再設定',
  'auth.password_reset.failed': 'パスワードの再設定の失敗',
  'staff.admin.bootstrapped': '最初の管理者の登録',
  'staff.admin.created': 'スタッフの登録',
  'staff.admin.create_rejected': 'スタッフの登録を断った',
  'staff.admin.updated': 'スタッフ情報の変更',
  'staff.admin.update_rejected': 'スタッフ情報の変更を断った',
  'staff.admin.deleted': 'スタッフの削除',
  'staff.admin.delete_rejected': 'スタッフの削除を断った',
  'staff.admin.password_guide_sent': 'パスワード設定の案内を送信',
  'staff.admin.password_guide_rejected': 'パスワード設定の案内を断った',
  'staff.import.completed': 'スタッフ台帳の取込',
  'settings.ai_prompts.updated': 'AIプロンプトの変更',
  'settings.ai_prompts.update_rejected': 'AIプロンプトの変更を断った',
  'settings.gemini_api_key.changed': 'Gemini APIキーの変更',
  'settings.gemini_api_key.save_rejected': 'Gemini APIキーの保存を断った',
  'settings.gemini_models.changed': 'Geminiモデルの変更',
  'settings.gemini_models.save_rejected': 'Geminiモデルの保存を断った',
  'settings.gemini_models.listed': 'Geminiモデル一覧の取得',
  'settings.gemini_models.list_failed': 'Geminiモデル一覧の取得の失敗',
  'settings.gchat_webhooks.changed': '通知用Webhook URLの変更',
  'settings.gchat_webhooks.save_rejected': '通知用Webhook URLの保存を断った',
  'settings.secret.unreadable': '保存した秘密値を読めなかった',
  'audit_log.viewed': '操作ログの閲覧',
  'audit_log.exported': '操作ログのCSVダウンロード',
  'attendance.day.update': '出勤簿の修正',
  'attendance.day.update_conflict': '出勤簿の修正の競合',
  'attendance.day.update_locked': '締め済みの出勤簿の修正を断った',
  'attendance.day.hidden_visits': '出勤簿に載らない4件目以降の訪問',
  'attendance.day.view': '出勤簿の閲覧',
  'attendance.week.view': '週間予定の閲覧',
  'attendance.month.view': '今月のまとめの閲覧',
  'attendance.export.downloaded': '出勤簿のExcelの書き出し',
  'attendance.export_all.downloaded': '全員分の出勤簿のExcelの書き出し',
  'attendance.calendar_sync.preview': 'カレンダーとの見比べ',
  'attendance.calendar_sync.apply': 'カレンダーから出勤簿へ反映',
  'attendance.calendar_sync.apply_failed': 'カレンダーから出勤簿への反映の失敗',
  'attendance.aggregate.refresh': '勤怠集計の書き直し',
  'attendance.nightly_sync.done': '夜間の出勤簿への反映',
  'attendance.nightly_sync.staff_failed': '夜間の出勤簿への反映の失敗(スタッフ)',
  'attendance.nightly_sync.tenant_failed': '夜間の出勤簿への反映の失敗',
  'attendance.sheet_import.done': '出勤簿の取込',
  'schedule.view.succeeded': '予定の閲覧',
  'schedule.view.failed': '予定の取得の失敗',
  'schedule.route.succeeded': 'ルートつき予定の閲覧',
  'schedule.route.failed': 'ルートつき予定の取得の失敗',
  'schedule.route_fresh.succeeded': '記録用の予定の取得',
  'schedule.route_fresh.failed': '記録用の予定の取得の失敗',
  'schedule.route_leg_failed': 'ルート計算の失敗',
  'schedule.calendar_read_failed': 'カレンダーの読み込みの失敗',
  'report.daily.saved': '日報の保存',
  'report.daily.save_denied': '日報の保存を断った',
  'report.accident.saved': '事故報告の保存',
  'report.accident.save_denied': '事故報告の保存を断った',
  'report.list.viewed': '日報・事故報告の一覧の閲覧',
  'report.list.exported': '日報・事故報告のCSVダウンロード',
  'report.detail.viewed': '日報・事故報告の閲覧',
  'report.detail.view_denied': '他のスタッフの報告の閲覧を断った',
  'receipt.uploaded': '領収書の登録',
  'receipt.list.viewed': '他のスタッフの領収書の一覧の閲覧',
  'receipt.list.exported': '領収書の一覧のCSVダウンロード',
  'receipt.list.view_denied': '他のスタッフの領収書の一覧の閲覧を断った',
  'receipt.list.export_denied': '領収書の一覧のCSVダウンロードを断った',
  'receipt.image.view_denied': '他のスタッフの領収書の画像の閲覧を断った',
  'receipt.image.unavailable': '領収書の画像を読めなかった',
  'customer.detail.viewed': 'お客様の情報の閲覧',
  'customer_csv.imported': '顧客CSVの取込',
  'customer_csv.import_review_required': '顧客CSVの取込を保留(確認が必要)',
  'customer_csv.import_failed': '顧客CSVの取込の失敗',
  'ai.daily_report.generate_failed': '日報のAI生成の失敗',
  'ai.accident_report.generate_failed': '事故報告のAI生成の失敗',
  'ai.receipt_ocr.failed': '領収書の読み取りの失敗',
  'notification.gchat.failed': 'Google Chatへの通知の失敗',
  'notification.gchat.not_configured': 'Google Chatの通知先が未設定',
  'outbox.message_failed': '外部への送信の失敗',
  'outbox.lease_lost': '外部への送信の処理が途中で切れた',
  'outbox.mirror_other_tenant_skipped': 'ミラーの対象でない法人のスプレッドシートへの反映を止めた',
  'ai.settings.read_failed': 'AIの設定を読めなかった',
  'attendance.aggregate.refresh_denied': '勤怠集計の書き直しを断った',
  'attendance.aggregate.refresh_failed': '勤怠集計の書き直しの失敗',
  'attendance.calendar_sync.preview_failed': 'カレンダーとの見比べの失敗',
  'calendar.busy_blocks.sync': 'カレンダーの予定あり時間の同期',
  'calendar.busy_blocks.sync_error': 'カレンダーの予定あり時間の同期の失敗',
  'calendar.staff_calendar_not_allowed': '許可されていないカレンダーを読まなかった',
  'maintenance.app_log_partitions.create_failed': '操作ログの保存先の作成の失敗',
  'maintenance.app_log_partitions.drop_failed': '古い操作ログの削除の失敗',
  'maintenance.rate_limits.purge_failed': '回数の記録の削除の失敗',
  'maintenance.retention.done': '保存期間を過ぎたデータの削除',
  'maintenance.retention.failed': '保存期間を過ぎたデータの削除の失敗',
  'mirror.receipt.image_missing': '領収書の画像が無いためスプレッドシートへ送れなかった',
  'push.subscription.saved': 'スマホへの通知の登録',
  'push.subscription.deleted': 'スマホへの通知の解除',
  'push.subscription.expired': '使えなくなったスマホへの通知の登録を削除',
  'push.subscription.rejected': 'スマホへの通知を受け付けてもらえなかった(3回続けば登録を削除)',
  'push.notice.expired': '期限を過ぎたスマホへの通知を送らずに終了',
  'push.test.queued': 'スマホへのテスト通知',
  'push.route_notice.done': '翌日の予定のお知らせの送信',
  'push.route_notice.staff_failed': '翌日の予定のお知らせの失敗(スタッフ)',
  'push.route_notice.tenant_failed': '翌日の予定のお知らせの失敗',
  'schedule.view.error': '予定の取得のエラー',
  'schedule.route.error': 'ルートつき予定の取得のエラー',
  'schedule.route_fresh.error': '記録用の予定の取得のエラー',
  'tenant.provisioned': '法人の作成',
  'tenant.calendar_settings.updated': 'カレンダーの設定の変更(運用担当者)',
  'tenant.customer_import_settings.updated': '顧客データの取込元の設定の変更(運用担当者)',
  'tenant.api_key.created': '外部連携のAPIキーの発行(運用担当者)',
  'tenant.api_key.revoked': '外部連携のAPIキーの失効(運用担当者)',
  'integration.customers.ingested': '外部システムからの顧客の受け取り',
  'integration.customers.ingest_failed': '外部システムからの顧客の受け取りの失敗',
  'integration.auth_failed': '外部連携のAPIキーの認証の失敗',
  'integration.auth_locked': '外部連携のAPIキーの認証の失敗が続いたため一時的に断り始めた',
  'rate_limit.exceeded': '回数の上限を超えた',
};

const ACCESS_DENIED_SUFFIX = '.access_denied';

/** 操作コードの表示名。権限のない操作(…access_denied)はまとめて「権限のない操作を断った」。 */
export function auditActionLabel(action: string): string {
  const label = AUDIT_ACTION_LABELS[action];
  if (label) return label;
  if (action.endsWith(ACCESS_DENIED_SUFFIX))
    return `権限のない操作を断った(${action.slice(0, -ACCESS_DENIED_SUFFIX.length)})`;
  return action;
}

function detailValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (Array.isArray(value)) return value.map(detailValue).join('・') || '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** details を「key: value, key: value」の1行にする(配列は「・」でつなぐ)。 */
export function formatAuditDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${detailValue(value)}`)
    .join(', ');
}

/** 絶対時刻をタイムゾーンの 'YYYY-MM-DD HH:mm:ss' にする。 */
export function formatZonedDateTime(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
