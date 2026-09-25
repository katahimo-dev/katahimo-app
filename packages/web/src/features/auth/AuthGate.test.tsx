import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../../api/auth';
import { ApiRequestError, api, NetworkError } from '../../api/client';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { STORAGE_KEYS, userStorageKey } from '../../lib/storage';
import { createTestQueryClient, createWrapper, TEST_USER } from '../../test/providers';
import { AuthGate, SESSION_EXPIRED_MESSAGE } from './AuthGate';

vi.mock('../../api/auth', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));

const me = vi.mocked(authApi.me);
const unauthenticated = () =>
  new ApiRequestError(401, { code: 'unauthenticated', message: 'ログインしてください' });

function renderGate() {
  const Wrapper = createWrapper({ queryClient: createTestQueryClient(), user: null });
  return render(
    <Wrapper>
      <AuthGate>
        <div>アプリ本体</div>
      </AuthGate>
    </Wrapper>,
  );
}

describe('AuthGate', () => {
  beforeEach(() => {
    me.mockReset();
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
