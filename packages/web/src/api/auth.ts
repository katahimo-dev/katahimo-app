import {
  type ChangePasswordRequest,
  changePasswordResponseSchema,
  type LoginRequest,
  okResponseSchema,
  type PasswordResetConfirm,
  type PasswordResetRequest,
  passwordResetConfirmResponseSchema,
  passwordResetRequestResponseSchema,
  sessionUserResponseSchema,
} from '@katahimo/shared';
import { api } from './client';

/** 認証API(doc/api/auth-reports-settings.md「認証 /api/auth」)。 */
export const authApi = {
  /** GET /api/auth/me。未ログイン(401)はセッション切れ扱いにせず呼び出し側で判断する。 */
  me: (signal?: AbortSignal) =>
    api.get('/api/auth/me', sessionUserResponseSchema, undefined, { signal, skipAuthHandler: true }),
  login: (body: LoginRequest) =>
    api.post('/api/auth/login', sessionUserResponseSchema, body, { skipAuthHandler: true }),
  logout: () => api.post('/api/auth/logout', okResponseSchema, {}, { skipAuthHandler: true }),
  changePassword: (body: ChangePasswordRequest) =>
    api.post('/api/auth/change-password', changePasswordResponseSchema, body),
  requestPasswordReset: (body: PasswordResetRequest) =>
    api.post('/api/auth/password-reset/request', passwordResetRequestResponseSchema, body, {
      skipAuthHandler: true,
    }),
  confirmPasswordReset: (body: PasswordResetConfirm) =>
    api.post('/api/auth/password-reset/confirm', passwordResetConfirmResponseSchema, body, {
      skipAuthHandler: true,
    }),
};
