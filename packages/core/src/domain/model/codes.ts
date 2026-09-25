/**
 * システムが決める状態・種別のコード(DB は text + CHECK、値は英語)。DB の CHECK 制約
 * (packages/db/src/schema)と TypeScript の型はここの一覧から作る。テナントが増減させる分類
 * (サービス種別・属性・担当エリア等)はコードではなく参照テーブルにする。
 */

export const TENANT_STATUSES = ['provisioning', 'active', 'suspended', 'terminating', 'terminated'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const BUSINESS_TYPES = ['babysitting', 'home_nursing'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const TENANT_LIFECYCLE_EVENTS = [
  'provisioned',
  'activated',
  'suspended',
  'resumed',
  'termination_requested',
  'terminated',
  'purged',
] as const;

export const DATA_KEY_STATES = ['active', 'decrypt_only', 'destroyed'] as const;
export type DataKeyState = (typeof DATA_KEY_STATES)[number];

/** テナントの秘密値(tenant_secrets.name)。 */
export const TENANT_SECRET_NAMES = [
  'gemini_api_key',
  'gchat_report_webhook',
  'gchat_receipt_webhook',
] as const;
export type TenantSecretName = (typeof TENANT_SECRET_NAMES)[number];

export const IMPORT_SOURCES = ['reserva_csv', 'staff_master_csv'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const IMPORT_RUN_STATUSES = ['running', 'applied', 'review_required', 'failed', 'skipped'] as const;
export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export const CUSTOM_FIELD_ENTITIES = ['staff', 'customer'] as const;
export const CUSTOM_FIELD_VALUE_TYPES = ['text', 'number', 'boolean', 'date', 'select'] as const;

/** スタッフの権限。admin: 全操作 / coordinator: 他スタッフの予定・出勤簿・報告の代行(管理設定は不可) / staff: 本人のみ。 */
export const STAFF_ROLES = ['staff', 'coordinator', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const GENDERS = ['female', 'male', 'other', 'unknown'] as const;
export type Gender = (typeof GENDERS)[number];

export const TRAVEL_MODES = ['car', 'bicycle', 'transit', 'walk'] as const;
export type TravelModeCode = (typeof TRAVEL_MODES)[number];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor'] as const;

export const ARCHIVE_REASONS = ['import_missing', 'manual'] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

export const CUSTOMER_SOURCES = ['reserva'] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

export const ADDRESS_KINDS = ['home', 'secondary', 'visit'] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

export const RESERVATION_STATUSES = ['requested', 'tentative', 'confirmed', 'cancelled', 'done'] as const;
export const ASSIGNMENT_STATUSES = ['proposed', 'confirmed', 'declined', 'cancelled'] as const;

export const VISIT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_SOURCES = ['google_calendar', 'manual', 'reservation'] as const;
export type VisitSource = (typeof VISIT_SOURCES)[number];

export const WORK_SEGMENT_KINDS = ['office', 'training', 'other'] as const;
export const TRAVEL_LEG_KINDS = ['commute', 'between', 'return'] as const;
export type TravelLegKind = (typeof TRAVEL_LEG_KINDS)[number];
/** 移動後の天候。表示名(出勤簿の選択肢)との対応は domain/attendance/sheetLayout.ts。 */
export const WEATHER_CODES = ['sunny', 'cloudy', 'rain', 'snow'] as const;
export type WeatherCode = (typeof WEATHER_CODES)[number];

export const ATTENDANCE_DAY_STATUSES = ['open', 'submitted', 'locked'] as const;
export const ATTENDANCE_PERIOD_STATUSES = ['open', 'locked'] as const;

export const CARE_RECORD_TYPES = ['daily_report', 'accident', 'near_miss'] as const;
export type CareRecordType = (typeof CARE_RECORD_TYPES)[number];
export const CARE_RECORD_STATUSES = ['draft', 'submitted', 'locked'] as const;
export type CareRecordStatus = (typeof CARE_RECORD_STATUSES)[number];

export const STORED_FILE_PURPOSES = ['receipt_image', 'evidence', 'export'] as const;
export type StoredFilePurpose = (typeof STORED_FILE_PURPOSES)[number];

export const AI_PROMPT_KINDS = ['prompt', 'placeholder'] as const;

export const ATTRIBUTE_CATEGORIES = ['skill', 'qualification', 'trait', 'language', 'other'] as const;
export const ATTRIBUTE_VALUE_TYPES = ['boolean', 'level', 'text'] as const;
export const AFFINITY_SOURCES = ['manual', 'feedback'] as const;
export const AVAILABILITY_EXCEPTION_KINDS = ['unavailable', 'extra_available'] as const;
export const CALENDAR_PURPOSES = ['schedule', 'busy'] as const;
export const BUSY_BLOCK_SOURCES = ['google_calendar', 'manual'] as const;
export const MATCHING_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

/** outbox のトピック。ペイロードはIDのみ(個人情報を入れない。ワーカーがDBから読み直す)。 */
export const OUTBOX_TOPICS = [
  'mirror.attendance_day',
  'mirror.attendance_aggregate',
  'mirror.care_record',
  'mirror.receipt',
  'mail.password_reset',
] as const;
export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];
/** スプレッドシートへのミラー(MIRROR_TO_GOOGLE_SHEETS が有効な時だけ積む・送る)。 */
export const MIRROR_TOPICS: readonly OutboxTopic[] = [
  'mirror.attendance_day',
  'mirror.attendance_aggregate',
  'mirror.care_record',
  'mirror.receipt',
];
export const OUTBOX_STATUSES = ['pending', 'processing', 'done', 'failed', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const ENTITY_TYPES = [
  'attendance_day',
  'visit',
  'work_segment',
  'travel_leg',
  'customer',
  'care_recipient',
  'staff',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const CHANGE_SOURCES = ['user', 'calendar_sync', 'import', 'system'] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export const APP_LOG_LEVELS = ['INFO', 'WARN', 'ERROR', 'SECURITY'] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];
export const ACTOR_TYPES = ['staff', 'system', 'operator', 'anonymous'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const DATA_EXPORT_SCOPES = ['tenant', 'customer', 'staff'] as const;
export const DATA_EXPORT_STATUSES = ['requested', 'processing', 'ready', 'expired', 'failed'] as const;
export const DATA_SUBJECT_REQUEST_KINDS = ['access', 'rectification', 'erasure', 'restriction'] as const;
export const DATA_SUBJECT_TYPES = ['customer', 'care_recipient', 'staff'] as const;
export const DATA_SUBJECT_REQUEST_STATUSES = ['received', 'in_progress', 'completed', 'rejected'] as const;
export const RETENTION_TARGETS = [
  'care_records',
  'receipts',
  'stored_files',
  'sessions',
  'outbox',
  'matching_run_candidates',
] as const;
