import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../../api/auth';
import { STORAGE_KEYS } from '../../lib/storage';
import { createWrapper } from '../../test/providers';
import { LoginScreen } from './LoginScreen';

vi.mock('../../api/auth', () => ({
  authApi: { login: vi.fn(), requestPasswordReset: vi.fn(), confirmPasswordReset: vi.fn() },
}));
vi.mock('../../ui/confirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/confirm')>()),
  alertNative: vi.fn(),
}));

function renderLogin() {
  const Wrapper = createWrapper({ user: null });
  return render(
    <Wrapper>
      <LoginScreen onLoggedIn={() => undefined} />
    </Wrapper>,
  );
}

describe('ログイン画面: 届いている番号でパスワードを設定する', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem(STORAGE_KEYS.lastTenantSlug, 'demo');
  });

  it('「番号が届いている方はこちら」は番号を送り直さずに番号の入力へ進み、そのメールアドレスで設定する', async () => {
    vi.mocked(authApi.confirmPasswordReset).mockResolvedValue({
      ok: true,
      message: 'パスワードを変更しました',
    });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを忘れたときはこちら' }));
    fireEvent.click(screen.getByRole('button', { name: '番号が届いている方はこちら' }));
    expect(screen.getByRole('alert').textContent).toBe('メールアドレスを入力してください');

    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'jiro@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '番号が届いている方はこちら' }));
    fireEvent.change(screen.getByLabelText('メールに届いた6けたの番号'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('新しいパスワード'), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'このパスワードにする' }));
    await waitFor(() =>
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith({
        tenantSlug: 'demo',
        email: 'jiro@example.com',
        code: '123456',
        newPassword: 'new-password-1',
      }),
    );
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
  });
});
