import { z } from 'zod';
import { newPasswordSchema } from './auth';
import { businessDateSchema, idSchema } from './common';

const emailSchema = z.string().trim().email('メールアドレスの形式が正しくありません');
const nameSchema = z.string().trim().min(1, '氏名を入力してください');

/** 管理者向けスタッフ一覧の1件(退職者を含む)。 */
export const adminStaffViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  altEmail: z.string().nullable(),
  phone: z.string().nullable(),
  isAdmin: z.boolean(),
  /** 'YYYY-MM-DD'。この日以降はログインできない(GAS版スタッフ台帳H列と同じ意味)。 */
  retirementDate: businessDateSchema.nullable(),
  /** 退職日を過ぎている(JST基準)。 */
  isRetired: z.boolean(),
  /**
   * パスワードの状態。
   * - set: 本アプリのパスワード(argon2id)が設定済み
   * - legacy: GAS版のパスワードハッシュのまま(次回ログイン時に自動で移行される)
   * - unset: 未設定(本人がパスワード再設定の手順で初回パスワードを設定する)
   */
  passwordStatus: z.enum(['set', 'legacy', 'unset']),
});
export type AdminStaffView = z.infer<typeof adminStaffViewSchema>;

/** GET /api/admin/staff */
export const adminStaffListResponseSchema = z.object({ staff: z.array(adminStaffViewSchema) });
export type AdminStaffListResponse = z.infer<typeof adminStaffListResponseSchema>;

/**
 * POST /api/admin/staff
 * initialPasswordを省略した場合はパスワード未設定で登録し、本人にパスワード再設定
 * (POST /api/auth/password-reset/request)で初回パスワードを設定してもらう。
 */
export const createStaffRequestSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  altEmail: emailSchema.nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  isAdmin: z.boolean().default(false),
  initialPassword: newPasswordSchema.optional(),
});
export type CreateStaffRequest = z.infer<typeof createStaffRequestSchema>;

/** PATCH /api/admin/staff/:id 渡した項目だけを更新する。nullは値の削除。 */
export const updateStaffRequestSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    altEmail: emailSchema.nullable(),
    phone: z.string().trim().nullable(),
    isAdmin: z.boolean(),
    retirementDate: businessDateSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: '更新する項目がありません' });
export type UpdateStaffRequest = z.infer<typeof updateStaffRequestSchema>;

/** POST/PATCH のレスポンス。 */
export const adminStaffResponseSchema = z.object({ staff: adminStaffViewSchema });
export type AdminStaffResponse = z.infer<typeof adminStaffResponseSchema>;

// ── GET /api/staff ───────────────────────────────────────────

/**
 * 管理者用「表示するスタッフ」の選択肢(退職者を除く、氏名順)。
 * 管理者以外が呼ぶと空配列(GAS版 getActiveStaffNamesForAdmin と同じ)。
 */
export const activeStaffSchema = z.object({ id: idSchema, name: z.string() });
export type ActiveStaff = z.infer<typeof activeStaffSchema>;
export const activeStaffListResponseSchema = z.object({ staff: z.array(activeStaffSchema) });
export type ActiveStaffListResponse = z.infer<typeof activeStaffListResponseSchema>;
