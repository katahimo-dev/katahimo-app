import type { DemoConfigResponse } from '@katahimo/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../../api/auth';
import { NetworkError } from '../../api/client';
import { demoApi } from '../../api/demo';
import { STORAGE_KEYS } from '../../lib/storage';
import { createWrapper } from '../../test/providers';
import { LoginScreen } from './LoginScreen';

vi.mock('../../api/auth', () => ({
  authApi: { login: vi.fn(), requestPasswordReset: vi.fn(), confirmPasswordReset: vi.fn() },
}));
vi.mock('../../api/demo', () => ({ demoApi: { config: vi.fn() } }));
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
    vi.mocked(demoApi.config).mockResolvedValue({ enabled: false });
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

const DEMO_CONFIG = {
  enabled: true,
  tenantSlug: 'public-demo',
  publicLogin: true,
  accounts: [
    { role: 'admin', label: '管理者', email: 'admin@demo.example.com' },
    { role: 'coordinator', label: 'コーディネーター', email: 'coordinator@demo.example.com' },
    { role: 'staff', label: 'スタッフ', email: 'staff@demo.example.com' },
  ],
  password: 'demo-pass',
  dataRetentionDays: 30,
  logRetentionMonths: 6,
  aiUsesPerSession: 5,
} as const satisfies DemoConfigResponse;

const NOTICE_TEXT = '入力した内容（30日間）と、操作ログ・接続情報（IPアドレス等。6か月間）を保存し';

describe('ログイン画面: 公開デモ(GET /api/demo/config)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('デモではない(enabled: false): 注意書き・デモ用アカウントは出さず、法人ID欄と再設定の案内を出す', async () => {
    vi.mocked(demoApi.config).mockResolvedValue({ enabled: false });
    renderLogin();
    expect(await screen.findByLabelText('法人ID')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'コーディネーター' })).toBeNull();
    expect(screen.getByRole('button', { name: 'パスワードを忘れたときはこちら' })).toBeTruthy();
  });

  it('設定を読めなかったときはデモではない扱い', async () => {
    vi.mocked(demoApi.config).mockRejectedValue(new NetworkError('offline'));
    renderLogin();
    expect(await screen.findByLabelText('法人ID')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('デモ専用の環境(publicLogin): デモ用テナントを既定にし、注意書きとデモ用アカウントを出す。押すとそのアカウントでログインする', async () => {
    vi.mocked(demoApi.config).mockResolvedValue(DEMO_CONFIG);
    vi.mocked(authApi.login).mockResolvedValue({
      staff: {
        staffId: 's',
        tenantId: 't',
        name: '山田 花子',
        email: 'coordinator@demo.example.com',
        role: 'coordinator',
        demoTenant: true,
      },
    });
    renderLogin();
    const picker = await screen.findByRole('button', { name: 'コーディネーター' });
    expect(screen.getByText('デモ用アカウント(パスワード: demo-pass)')).toBeTruthy();
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('これは公開デモです');
    expect(note.textContent).toContain(NOTICE_TEXT);
    expect(note.textContent).toContain('実在の人物の名前・連絡先は入力しないでください');
    expect(screen.queryByLabelText('法人ID')).toBeNull();
    expect(screen.queryByRole('button', { name: 'パスワードを忘れたときはこちら' })).toBeNull();

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    await waitFor(() =>
      expect(authApi.login).toHaveBeenCalledWith({
        tenantSlug: 'public-demo',
        email: 'coordinator@demo.example.com',
        password: 'demo-pass',
      }),
    );
  });

  it('デモ専用の環境でも、最後にログインした別の法人IDが先。デモ用テナントではないので注意書き・デモ用アカウントは出さず、再設定の案内を出す', async () => {
    localStorage.setItem(STORAGE_KEYS.lastTenantSlug, 'acme');
    vi.mocked(demoApi.config).mockResolvedValue(DEMO_CONFIG);
    renderLogin();
    expect(await screen.findByRole('button', { name: 'パスワードを忘れたときはこちら' })).toBeTruthy();
    // 設定が届いて描き直したあとも出さない
    await waitFor(() => expect(demoApi.config).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: 'パスワードを忘れたときはこちら' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'コーディネーター' })).toBeNull();
  });

  it('保存期間が無い(本番の環境に置いたデモ用テナントで未設定)ときは、期間も「毎晩」も書かない', async () => {
    vi.mocked(demoApi.config).mockResolvedValue({
      ...DEMO_CONFIG,
      publicLogin: false,
      accounts: [],
      password: null,
      dataRetentionDays: null,
      logRetentionMonths: null,
    });
    renderLogin();
    fireEvent.change(await screen.findByLabelText('法人ID'), { target: { value: 'public-demo' } });
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(
      '入力した内容と、操作ログ・接続情報（IPアドレス等）を保存し、サービスの改善と不正利用の調査に使います。',
    );
    expect(note.textContent).not.toMatch(/日間|か月間|毎晩/);
  });

  it('本番の環境に置いたデモ用テナント(publicLogin: false): その法人IDを入れたときだけ注意書きを出し、アカウントは出さない', async () => {
    vi.mocked(demoApi.config).mockResolvedValue({
      ...DEMO_CONFIG,
      publicLogin: false,
      accounts: [],
      password: null,
    });
    renderLogin();
    const tenantInput = await screen.findByLabelText('法人ID');
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: 'パスワードを忘れたときはこちら' })).toBeTruthy();

    fireEvent.change(tenantInput, { target: { value: 'Public-Demo ' } });
    expect(screen.getByRole('note').textContent).toContain(NOTICE_TEXT);
    expect(screen.queryByRole('button', { name: 'コーディネーター' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'パスワードを忘れたときはこちら' })).toBeNull();

    fireEvent.change(tenantInput, { target: { value: 'acme' } });
    expect(screen.queryByRole('note')).toBeNull();
  });
});
