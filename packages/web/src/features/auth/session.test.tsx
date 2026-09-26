import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../../api/auth';
import { STORAGE_KEYS, userStorageKey } from '../../lib/storage';
import { createWrapper, TEST_USER } from '../../test/providers';
import { releaseForeignPushSubscription, stopPushOnThisDevice } from '../notifications/pushDevice';
import { useSession } from './session';

vi.mock('../../api/auth', () => ({ authApi: { logout: vi.fn(async () => ({ ok: true })) } }));
vi.mock('../notifications/pushDevice', () => ({
  stopPushOnThisDevice: vi.fn(async () => undefined),
  releaseForeignPushSubscription: vi.fn(async () => undefined),
}));

const pushKey = userStorageKey(STORAGE_KEYS.pushEndpoint, {
  tenantId: TEST_USER.tenantId,
  staffId: TEST_USER.staffId,
});

describe('セッションと通知の購読', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('ログインしたら、この端末に残る別の人の購読をやめる', async () => {
    renderHook(() => useSession(), { wrapper: createWrapper() });
    await waitFor(() => expect(releaseForeignPushSubscription).toHaveBeenCalledWith(pushKey));
  });

  it('ログアウトは、ログアウトの API より前に本人の通知をやめる', async () => {
    vi.stubGlobal('location', { ...window.location, reload: vi.fn() });
    const order: string[] = [];
    vi.mocked(stopPushOnThisDevice).mockImplementation(async () => {
      order.push('push');
    });
    vi.mocked(authApi.logout).mockImplementation(async () => {
      order.push('logout');
      return { ok: true };
    });
    const { result } = renderHook(() => useSession(), { wrapper: createWrapper() });
    await act(() => result.current.logout());
    expect(stopPushOnThisDevice).toHaveBeenCalledWith(pushKey);
    expect(order).toEqual(['push', 'logout']);
  });
});
