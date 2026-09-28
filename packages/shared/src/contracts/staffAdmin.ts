import { z } from 'zod';
import { newPasswordSchema } from './auth';
import { businessDateSchema, freeText, idSchema } from './common';
import { staffRoleSchema } from './roles';

/** 移動手段(staff.travel_mode)。未設定のスタッフは car(GAS版は全員 DRIVING)。 */
export const TRAVEL_MODES = ['car', 'bicycle', 'transit', 'walk'] as const;
export type TravelModeCode = (typeof TRAVEL_MODES)[number];
export const travelModeSchema = z.enum(TRAVEL_MODES);

/** 性別(staff.gender)。 */
export const GENDERS = ['female', 'male', 'other', 'unknown'] as const;
export type Gender = (typeof GENDERS)[number];
export const genderSchema = z.enum(GENDERS);

const emailSchema = z.string().trim().email('メールアドレスの形式が正しくありません');
const nameSchema = freeText(z.string().trim().min(1, '氏名を入力してください').max(100, '氏名が長すぎます'));
/** 空欄は null(値の削除)にそろえる任意の文字列。 */
const optionalText = (max: number, message: string) =>
  freeText(z.string().trim().max(max, message).nullable()).transform((v) => v || null);
/** Google カレンダーのID(メールアドレスの形か …@group.calendar.google.com)。空欄は null。 */
const calendarIdSchema = z
  .string()
  .trim()
  .max(254, 'カレンダーIDが長すぎます')
  .regex(/^(\S+@\S+)?$/, 'カレンダーIDは「…@…」の形で入力してください')
  .nullable()
  .transform((v) => v || null);

/**
 * パスワードの状態。
 * - set: 本アプリのパスワード(argon2id)が設定済み
 * - legacy: GAS版のパスワードハッシュのまま(次回ログイン時に自動で移行される)
 * - unset: 未設定(本人がパスワード再設定の手順で初回パスワードを設定する)
 */
export const passwordStatusSchema = z.enum(['set', 'legacy', 'unset']);
export type PasswordStatus = z.infer<typeof passwordStatusSchema>;

/** 管理者向けスタッフ一覧の1件(退職者を含む)。 */
export const adminStaffViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** 「セイ メイ」(姓・名のカナを空白でつなげたもの)。 */
  kana: z.string().nullable(),
  email: z.string(),
  altEmail: z.string().nullable(),
  phone: z.string().nullable(),
  role: staffRoleSchema,
  /** 'YYYY-MM-DD'。この日以降はログインできない(GAS版スタッフ台帳H列と同じ意味)。 */
  retiredOn: businessDateSchema.nullable(),
  /** 退職日を過ぎている(テナントのタイムゾーンの今日で判定)。 */
  isRetired: z.boolean(),
  passwordStatus: passwordStatusSchema,
  /** 自宅住所(出勤・退勤経路の起点)。 */
  homeAddress: z.string().nullable(),
  /** 自宅の緯度経度があるか(無ければルート計算のたびに住所からジオコーディングする)。 */
  hasHomeGeo: z.boolean(),
  /** 未設定は null(ルート計算は car)。 */
  travelMode: travelModeSchema.nullable(),
  gender: genderSchema.nullable(),
  /** 予定を読む Google カレンダーのID(staff_calendars の purpose = 'schedule')。 */
  scheduleCalendarId: z.string().nullable(),
  rowVersion: z.number().int(),
});
export type AdminStaffView = z.infer<typeof adminStaffViewSchema>;

/** GET /api/admin/staff */
export const adminStaffListResponseSchema = z.object({ staff: z.array(adminStaffViewSchema) });
export type AdminStaffListResponse = z.infer<typeof adminStaffListResponseSchema>;

/**
 * 登録・更新で共通の項目(null・空欄は値なし)。スタッフの xlsx の取込(core の staffSheet.ts)もセルをこの規則で確かめる。
 */
export const staffFieldSchemas = {
  name: nameSchema,
  kana: optionalText(100, 'カナが長すぎます'),
  email: emailSchema,
  altEmail: emailSchema.nullable(),
  phone: optionalText(30, '電話番号が長すぎます'),
  role: staffRoleSchema,
  homeAddress: optionalText(300, '住所が長すぎます'),
  travelMode: travelModeSchema.nullable(),
  gender: genderSchema.nullable(),
  scheduleCalendarId: calendarIdSchema,
};

/**
 * POST /api/admin/staff
 * initialPasswordを省略した場合はパスワード未設定で登録し、本人にパスワード再設定で初回パスワードを
 * 設定してもらう(POST /api/admin/staff/:id/password-guide で案内のメールを送れる)。
 */
export const createStaffRequestSchema = z.object({
  name: staffFieldSchemas.name,
  email: staffFieldSchemas.email,
  kana: staffFieldSchemas.kana.optional(),
  altEmail: staffFieldSchemas.altEmail.optional(),
  phone: staffFieldSchemas.phone.optional(),
  role: staffRoleSchema.default('staff'),
  homeAddress: staffFieldSchemas.homeAddress.optional(),
  travelMode: staffFieldSchemas.travelMode.optional(),
  gender: staffFieldSchemas.gender.optional(),
  scheduleCalendarId: staffFieldSchemas.scheduleCalendarId.optional(),
  initialPassword: newPasswordSchema.optional(),
});
export type CreateStaffRequest = z.input<typeof createStaffRequestSchema>;

/**
 * PATCH /api/admin/staff/:id 渡した項目だけを更新する。nullは値の削除。
 * rowVersion を渡すと、読んだ後に他の管理者が更新していれば 409 conflict にする。
 */
export const updateStaffRequestSchema = z
  .object({ ...staffFieldSchemas, retiredOn: businessDateSchema.nullable() })
  .partial()
  .extend({ rowVersion: z.number().int().nonnegative().optional() })
  .refine((v) => Object.keys(v).some((key) => key !== 'rowVersion'), {
    message: '更新する項目がありません',
  });
export type UpdateStaffRequest = z.input<typeof updateStaffRequestSchema>;

/**
 * 自宅住所のジオコーディングの結果(住所を登録・変更したときだけ。それ以外は null)。
 * ok 以外でも住所は保存済み(ルート計算のときに住所からジオコーディングする)。
 * - not_found: 住所が見つからなかった / failed: 地図APIの失敗 / unavailable: 地図APIを使わない環境
 */
export const homeGeocodeStatusSchema = z.enum(['ok', 'not_found', 'failed', 'unavailable']);
export type HomeGeocodeStatus = z.infer<typeof homeGeocodeStatusSchema>;

/** POST/PATCH のレスポンス。 */
export const adminStaffResponseSchema = z.object({
  staff: adminStaffViewSchema,
  homeGeocode: homeGeocodeStatusSchema.nullable(),
});
export type AdminStaffResponse = z.infer<typeof adminStaffResponseSchema>;

// ── GET /api/staff ───────────────────────────────────────────

/**
 * 「表示するスタッフ」の選択肢(退職者を除く、氏名順)。
 * 他のスタッフを扱えない役割(一般スタッフ)が呼ぶと空配列(GAS版 getActiveStaffNamesForAdmin と同じ)。
 */
export const activeStaffSchema = z.object({ id: idSchema, name: z.string() });
export type ActiveStaff = z.infer<typeof activeStaffSchema>;
export const activeStaffListResponseSchema = z.object({ staff: z.array(activeStaffSchema) });
export type ActiveStaffListResponse = z.infer<typeof activeStaffListResponseSchema>;

// ── スタッフの Excel 取込・書き出し(GET /api/admin/staff/export.xlsx・POST /api/admin/staff/import) ──

/** 取り込める xlsx の大きさの上限。 */
export const STAFF_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** 1回で取り込めるスタッフの行数の上限。 */
export const STAFF_IMPORT_MAX_ROWS = 500;

/**
 * スタッフの xlsx のシート「スタッフ」の列(見出しで見分ける。並び順は問わない)。書き出したファイルはそのまま取り込める。
 * ID は書き出したときのスタッフの ID(空欄の行は新しいスタッフ。ID が無い行はメールアドレスで既存のスタッフを探す)。
 * 役割・移動手段・性別は画面と同じ日本語の名前で書く。パスワードは扱わない。
 */
export const STAFF_SHEET_NAME = 'スタッフ';
export const STAFF_SHEET_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: '氏名' },
  { key: 'kana', label: 'カナ' },
  { key: 'email', label: 'メールアドレス' },
  { key: 'altEmail', label: 'サブメール' },
  { key: 'phone', label: '電話' },
  { key: 'role', label: '役割' },
  { key: 'retiredOn', label: '退職日' },
  { key: 'homeAddress', label: '自宅住所' },
  { key: 'travelMode', label: '移動手段' },
  { key: 'gender', label: '性別' },
  { key: 'scheduleCalendarId', label: '予定カレンダーID' },
] as const;
export type StaffSheetColumnKey = (typeof STAFF_SHEET_COLUMNS)[number]['key'];

export const STAFF_ROLE_LABELS: Record<z.infer<typeof staffRoleSchema>, string> = {
  staff: 'スタッフ',
  coordinator: 'コーディネーター',
  admin: '管理者',
};
export const TRAVEL_MODE_LABELS: Record<TravelModeCode, string> = {
  car: '車',
  bicycle: '自転車',
  transit: '電車・バス',
  walk: '徒歩',
};
export const GENDER_LABELS: Record<Gender, string> = {
  female: '女性',
  male: '男性',
  other: 'その他',
  unknown: '回答しない',
};

/**
 * POST /api/admin/staff/import。dryRun=true(既定)は確かめるだけで何も書かない。
 * 見出しのある列はセルの値で上書きし、空欄は値の削除(氏名・メールアドレスは必須)。見出しの無い列は今の値のまま。
 * ファイルに無いスタッフは変えない(消さない)。誤りが1件でもあれば反映しない。
 */
export const staffImportRequestSchema = z.object({
  fileName: z.string().trim().max(200).optional(),
  /** xlsx の中身(base64。data URL の頭は付けない)。 */
  fileBase64: z
    .string()
    .min(1, 'ファイルを選んでください')
    .max(Math.ceil((STAFF_IMPORT_MAX_BYTES * 4) / 3) + 4, 'ファイルが大きすぎます(2MBまで)'),
  dryRun: z.boolean().default(true),
});
export type StaffImportRequest = z.input<typeof staffImportRequestSchema>;

export const staffImportIssueSchema = z.object({
  /** Excel の行番号(1始まり)。ファイル全体の問題は null。 */
  row: z.number().int().nullable(),
  message: z.string(),
});
export type StaffImportIssue = z.infer<typeof staffImportIssueSchema>;

/** 反映する(した)行ごとの変更。unchanged の行は含めない。 */
export const staffImportChangeSchema = z.object({
  row: z.number().int(),
  kind: z.enum(['create', 'update']),
  name: z.string(),
  email: z.string(),
  /** 変わる列の見出し(STAFF_SHEET_COLUMNS の label)。 */
  fields: z.array(z.string()),
});
export type StaffImportChange = z.infer<typeof staffImportChangeSchema>;

export const staffImportResponseSchema = z.object({
  dryRun: z.boolean(),
  /** 反映したか(dryRun のとき・誤りがあるときは false)。 */
  applied: z.boolean(),
  counts: z.object({
    rows: z.number().int(),
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
  }),
  changes: z.array(staffImportChangeSchema),
  /** 反映できない誤り(1件でもあれば反映しない)。 */
  errors: z.array(staffImportIssueSchema),
  /** 反映はできるが知らせること(自宅住所の位置が分からなかった など)。 */
  warnings: z.array(staffImportIssueSchema),
});
export type StaffImportResponse = z.infer<typeof staffImportResponseSchema>;
