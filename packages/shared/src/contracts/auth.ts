import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_CODE_LENGTH,
  PASSWORD_RESET_CODE_PATTERN,
} from '../defaults/passwordPolicy';
import { idSchema } from './common';
import { staffRoleSchema } from './roles';

/** 新しいパスワードの入力規則(変更・再設定・管理者による初期パスワード設定で共通)。 */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください`)
  .max(PASSWORD_MAX_LENGTH, `パスワードは${PASSWORD_MAX_LENGTH}文字以内にしてください`);

/** ログインID。スタッフのメールアドレス(email)またはサブメール(altEmail)のどちらでもよい。 */
const loginIdSchema = z.string().trim().min(1, 'メールアドレスを入力してください');
const tenantSlugSchema = z.string().trim().min(1, '会社IDを入力してください');

/** POST /api/auth/login */
export const loginRequestSchema = z.object({
  tenantSlug: tenantSlugSchema,
  email: loginIdSchema,
  password: z.string().min(1, 'パスワードを入力してください'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * ログイン中ユーザーの情報。
 * GAS版は session token をクライアントに渡していたが、新方式は httpOnly Cookie のため
 * トークンはレスポンスに含めない(Cookieはブラウザが自動送信する)。
 */
export const sessionUserSchema = z.object({
  staffId: idSchema,
  tenantId: idSchema,
  name: z.string(),
  email: z.string(),
  /** 役割(isAdminRole / canActForOthers で表示を出し分ける)。 */
  role: staffRoleSchema,
  /** 公開デモ用のテナント(API の `DEMO_TENANT_SLUG`)にログインしているか。ログイン直後の注釈・「デモ環境」の帯を出す。 */
  demoTenant: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** POST /api/auth/login と GET /api/auth/me のレスポンス。 */
export const sessionUserResponseSchema = z.object({ staff: sessionUserSchema });
export type SessionUserResponse = z.infer<typeof sessionUserResponseSchema>;

/** POST /api/auth/change-password */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, '現在のパスワードを入力してください'),
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const changePasswordResponseSchema = z.object({ success: z.literal(true), message: z.string() });
export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;

/** POST /api/auth/password-reset/request */
export const passwordResetRequestSchema = z.object({
  tenantSlug: tenantSlugSchema,
  email: loginIdSchema,
});
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

/**
 * 再設定コードの発行要求への応答。アカウントの有無を推測されないよう、登録の有無・送信の成否に
 * かかわらず常に同じ内容を返す。
 */
export const passwordResetRequestResponseSchema = z.object({ ok: z.literal(true), message: z.string() });
export type PasswordResetRequestResponse = z.infer<typeof passwordResetRequestResponseSchema>;

/**
 * POST /api/auth/password-reset/confirm。code は8桁の数字(移行のあいだは6桁も受け付ける。
 * PASSWORD_RESET_CODE_PATTERN。6桁は次のリリースで外す)。
 */
export const passwordResetConfirmSchema = z.object({
  tenantSlug: tenantSlugSchema,
  email: loginIdSchema,
  code: z
    .string()
    .trim()
    .regex(PASSWORD_RESET_CODE_PATTERN, `認証コードは${PASSWORD_RESET_CODE_LENGTH}桁の数字です`),
  newPassword: newPasswordSchema,
});
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

export const passwordResetConfirmResponseSchema = z.object({ ok: z.literal(true), message: z.string() });
export type PasswordResetConfirmResponse = z.infer<typeof passwordResetConfirmResponseSchema>;
