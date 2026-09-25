import { z } from 'zod';
import { idSchema } from './common';

export const loginRequestSchema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
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
  isAdmin: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'パスワードは8文字以上にしてください'),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
