import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../../api/auth';
import { ApiRequestError, api, NetworkError } from '../../api/client';
import { demoApi } from '../../api/demo';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { STORAGE_KEYS, userStorageKey } from '../../lib/storage';
import { createTestQueryClient, createWrapper, TEST_USER } from '../../test/providers';
import { AuthGate, SESSION_EXPIRED_MESSAGE } from './AuthGate';
import { DemoBanner } from './demo';

vi.mock('../../api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));
vi.mock('../../api/demo', () => ({ demoApi: { config: vi.fn() } }));

const me = vi.mocked(authApi.me);
const unauthenticated = () =>
  new ApiRequestError(401, { code: 'unauthenticated', message: 'ログインしてください' });

function renderGate() {
  const Wrapper = createWrapper({ queryClient: createTestQueryClient(), user: null });
  return render(
    <Wrapper>
      <AuthGate>
        <DemoBanner />
        <div>アプリ本体</div>
      </AuthGate>
    </Wrapper>,
  );
}

describe('AuthGate', () => {
  beforeEach(() => {
    me.mockReset();
    vi.mocked(demoApi.config).mockResolvedValue({ enabled: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('401 ならログイン画面。以前ログインしていたら「しばらく使っていなかったので…」', async () => {
    localStorage.setItem(STORAGE_KEYS.sessionHint, '1');
    me.mockRejectedValue(unauthenticated());
    renderGate();
    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.sessionHint)).toBeNull();
  });

  it('ログインしていれば本体を出す', async () => {
    me.mockResolvedValue({ staff: TEST_USER });
    renderGate();
    expect(await screen.findByText('アプリ本体')).toBeTruthy();
  });

  it('起動時の通信の失敗はログイン切れにしない。「もう一度読み込む」で確かめ直す', async () => {
    localStorage.setItem(STORAGE_KEYS.sessionHint, '1');
    me.mockRejectedValueOnce(new NetworkError('offline'));
    renderGate();
    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'ログイン' })).toBeNull();
    // ログインしていた印は消さない(期限切れの案内を出すかどうかは、確かめられてから決める)
    expect(localStorage.getItem(STORAGE_KEYS.sessionHint)).toBe('1');

    me.mockResolvedValueOnce({ staff: TEST_USER });
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
    expect(await screen.findByText('アプリ本体')).toBeTruthy();
  });

  it('使っている途中の401: ログイン画面に戻し、表示用キャッシュを消す(その人の書きかけは残す)', async () => {
    me.mockResolvedValue({ staff: TEST_USER });
    renderGate();
    await screen.findByText('アプリ本体');

    const scope = { tenantId: TEST_USER.tenantId, staffId: TEST_USER.staffId };
    const draftKey = userStorageKey(STORAGE_KEYS.pendingReportDraft, scope);
    localStorage.setItem(`${STORAGE_KEYS.scheduleRouteCachePrefix}x_2026-09-25`, '{}');
    localStorage.setItem(`${STORAGE_KEYS.pastScheduleWeekCachePrefix}x_2026-09-20`, '{}');
    localStorage.setItem(draftKey, '{"customerId":"c1"}');

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ code: 'unauthenticated', message: 'x' }), { status: 401 }),
      ),
    );
    await expect(
      api.get('/api/anything', { safeParse: () => ({ success: true }) } as never),
    ).rejects.toThrow();

    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('アプリ本体')).toBeNull());
    expect(localStorage.getItem(`${STORAGE_KEYS.scheduleRouteCachePrefix}x_2026-09-25`)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.pastScheduleWeekCachePrefix}x_2026-09-20`)).toBeNull();
    expect(localStorage.getItem(draftKey)).not.toBeNull();
  });

  it('ログインすると、人ごとに分ける前の値(誰のものか分からない書きかけ)は消す', async () => {
    localStorage.setItem(STORAGE_KEYS.pendingReportDraft, '{"customerId":"c1"}');
    localStorage.setItem(STORAGE_KEYS.recentCustomers, '["c1"]');
    me.mockResolvedValue({ staff: TEST_USER });
    renderGate();
    await screen.findByText('アプリ本体');
    expect(localStorage.getItem(STORAGE_KEYS.pendingReportDraft)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.recentCustomers)).toBeNull();
  });
});

const DEMO_USER = { ...TEST_USER, demoTenant: true };

describe('AuthGate: 公開デモの注釈', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem(STORAGE_KEYS.lastTenantSlug, 'public-demo');
    vi.mocked(demoApi.config).mockResolvedValue({
      enabled: true,
      tenantSlug: 'public-demo',
      publicLogin: true,
      accounts: [{ role: 'admin', label: '管理者', email: 'admin@demo.example.com' }],
      password: 'demo-pass',
      dataRetentionDays: 30,
      logRetentionMonths: 24,
      aiUsesPerSession: 5,
    });
  });

  async function loginFromForm() {
    me.mockRejectedValue(unauthenticated());
    vi.mocked(authApi.login).mockResolvedValue({ staff: DEMO_USER });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: '管理者' }));
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    return screen.findByRole('dialog', { name: 'デモ環境をお使いになる前に' });
  }

  it('ログインの画面からログインすると注釈を出し、「同意して始める」で閉じる。帯から開き直せる', async () => {
    const dialog = await loginFromForm();
    expect(dialog.textContent).toContain('ほかの閲覧者にも見えます');
    expect(dialog.textContent).toContain(
      '入力した内容は運営者が30日間、操作ログ・接続情報（IPアドレス等）は24か月間保存し',
    );
    expect(dialog.textContent).toContain('パスワードの変更・再設定');
    expect(dialog.textContent).toContain('操作ログの閲覧');
    expect(dialog.textContent).toContain('Google Gemini');
    expect(dialog.textContent).toContain('1回のログインにつき5回まで');
    expect(dialog.textContent).toContain('実在の人物の名前・連絡先は入力しないでください');
    // ログインした直後は Escape では閉じない(同意してから使う)
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'デモ環境をお使いになる前に' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '同意して始める' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('アプリ本体')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: /デモ環境です。データは架空のもので、毎晩作り直します。.*注意事項を見る/,
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'デモ環境をお使いになる前に' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ログインした直後の注釈の「同意しない（ログアウト）」でログアウトする', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.mocked(authApi.logout).mockResolvedValue({ ok: true });
    await loginFromForm();
    fireEvent.click(screen.getByRole('button', { name: '同意しない（ログアウト）' }));
    await waitFor(() => expect(authApi.logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it('帯から開き直した注釈には「同意しない（ログアウト）」を出さない', async () => {
    me.mockResolvedValue({ staff: DEMO_USER });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /注意事項を見る/ }));
    await screen.findByRole('dialog', { name: 'デモ環境をお使いになる前に' });
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '同意しない（ログアウト）' })).toBeNull();
  });

  it('保存期間が無い(本番の環境に置いたデモ用テナント)ときは、注釈・帯に期間も「毎晩作り直します」も書かない', async () => {
    vi.mocked(demoApi.config).mockResolvedValue({
      enabled: true,
      tenantSlug: 'public-demo',
      publicLogin: false,
      accounts: [],
      password: null,
      dataRetentionDays: null,
      logRetentionMonths: null,
      aiUsesPerSession: 5,
    });
    me.mockResolvedValue({ staff: DEMO_USER });
    renderGate();
    const banner = await screen.findByRole('button', { name: /注意事項を見る/ });
    await waitFor(() => expect(banner.textContent).toContain('デモ環境です。データは架空のものです。'));
    expect(banner.textContent).not.toContain('毎晩');
    fireEvent.click(banner);
    const dialog = await screen.findByRole('dialog', { name: 'デモ環境をお使いになる前に' });
    expect(dialog.textContent).toContain(
      '入力した内容と、操作ログ・接続情報（IPアドレス等）は運営者が保存し、サービスの改善と不正利用の調査に使います。',
    );
    expect(dialog.textContent).not.toMatch(/毎晩|日間|か月間|その日に/);
  });

  it('設定を読めなかったときも、期間・「毎晩作り直します」は書かない', async () => {
    vi.mocked(demoApi.config).mockRejectedValue(new NetworkError('offline'));
    me.mockResolvedValue({ staff: DEMO_USER });
    renderGate();
    const banner = await screen.findByRole('button', { name: /注意事項を見る/ });
    await waitFor(() => expect(demoApi.config).toHaveBeenCalled());
    expect(banner.textContent).not.toContain('毎晩');
    fireEvent.click(banner);
    const dialog = await screen.findByRole('dialog', { name: 'デモ環境をお使いになる前に' });
    expect(dialog.textContent).not.toMatch(/毎晩|日間|か月間/);
    expect(dialog.textContent).toContain('1回のログインごとの上限があります');
  });

  it('ページを読み込み直したとき(ログイン済み)は注釈を出さず、帯だけ出す', async () => {
    me.mockResolvedValue({ staff: DEMO_USER });
    renderGate();
    await screen.findByText('アプリ本体');
    expect(screen.getByRole('button', { name: /注意事項を見る/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('デモ用テナントでなければ注釈も帯も出さない', async () => {
    me.mockRejectedValue(unauthenticated());
    vi.mocked(authApi.login).mockResolvedValue({ staff: TEST_USER });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: '管理者' }));
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    await screen.findByText('アプリ本体');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /注意事項を見る/ })).toBeNull();
  });
});
