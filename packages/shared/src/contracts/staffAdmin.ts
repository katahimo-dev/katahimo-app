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

/** 登録・更新で共通の項目(null・空欄は値なし)。 */
const staffFields = {
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
  name: staffFields.name,
  email: staffFields.email,
  kana: staffFields.kana.optional(),
  altEmail: staffFields.altEmail.optional(),
  phone: staffFields.phone.optional(),
  role: staffRoleSchema.default('staff'),
  homeAddress: staffFields.homeAddress.optional(),
  travelMode: staffFields.travelMode.optional(),
  gender: staffFields.gender.optional(),
  scheduleCalendarId: staffFields.scheduleCalendarId.optional(),
  initialPassword: newPasswordSchema.optional(),
});
export type CreateStaffRequest = z.input<typeof createStaffRequestSchema>;

/**
 * PATCH /api/admin/staff/:id 渡した項目だけを更新する。nullは値の削除。
 * rowVersion を渡すと、読んだ後に他の管理者が更新していれば 409 conflict にする。
 */
export const updateStaffRequestSchema = z
  .object({ ...staffFields, retiredOn: businessDateSchema.nullable() })
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
