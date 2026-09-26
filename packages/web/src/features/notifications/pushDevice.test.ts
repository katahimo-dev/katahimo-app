import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushApi } from '../../api/push';
import {
  releaseForeignPushSubscription,
  stopPushOnThisDevice,
  subscribeDevice,
  subscriptionUsesKey,
} from './pushDevice';
import { applicationServerKeyOf, usesApplicationServerKey } from './pushSupport';

vi.mock('../../api/push', () => ({
  pushApi: { unsubscribe: vi.fn(async () => ({ ok: true })) },
}));

/** 65バイトの鍵(base64url)。 */
const keyOf = (fill: number) =>
  btoa(String.fromCharCode(...new Uint8Array(65).fill(fill)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const CURRENT = keyOf(4);
const ROTATED = keyOf(7);
const STORAGE_KEY = 'katahimo_push_endpoint@t/s';

function fakeSubscription(endpoint: string, key: string) {
  return {
    endpoint,
    options: { applicationServerKey: applicationServerKeyOf(key).buffer },
    unsubscribe: vi.fn(async () => true),
  } as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };
}

function installServiceWorker(existing: PushSubscription | null) {
  const created = fakeSubscription('https://fcm.googleapis.com/fcm/send/new', CURRENT);
  const pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => created),
  };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { getRegistration: async () => ({ pushManager }) },
  });
  return { pushManager, created };
}

describe('この端末の購読', () => {
  beforeEach(() => {
    vi.mocked(pushApi.unsubscribe).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('購読の鍵が今の VAPID の公開鍵と同じか(ブラウザが教えなければ同じとみなす)', () => {
    expect(usesApplicationServerKey(applicationServerKeyOf(CURRENT).buffer, CURRENT)).toBe(true);
    expect(usesApplicationServerKey(applicationServerKeyOf(ROTATED).buffer, CURRENT)).toBe(false);
    expect(usesApplicationServerKey(null, CURRENT)).toBe(true);
    expect(subscriptionUsesKey(fakeSubscription('x', ROTATED), CURRENT)).toBe(false);
  });

  it('同じ鍵の購読があればそのまま使う', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', CURRENT);
    const { pushManager } = installServiceWorker(existing);
    expect(await subscribeDevice(CURRENT)).toBe(existing);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(pushApi.unsubscribe).not.toHaveBeenCalled();
  });

  it('鍵を作り直していたら、古い購読をサーバーから消して端末でもやめ、今の鍵で購読し直す', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', ROTATED);
    const { pushManager, created } = installServiceWorker(existing);
    expect(await subscribeDevice(CURRENT)).toBe(created);
    expect(pushApi.unsubscribe).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/old');
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  });

  it('ログアウト: 本人がオンにした購読だけをサーバーと端末でやめる', async () => {
    const mine = fakeSubscription('https://fcm.googleapis.com/fcm/send/mine', CURRENT);
    installServiceWorker(mine);
    localStorage.setItem(STORAGE_KEY, 'https://fcm.googleapis.com/fcm/send/someone-else');
    await stopPushOnThisDevice(STORAGE_KEY);
    expect(mine.unsubscribe).not.toHaveBeenCalled();

    localStorage.setItem(STORAGE_KEY, mine.endpoint);
    await stopPushOnThisDevice(STORAGE_KEY);
    expect(pushApi.unsubscribe).toHaveBeenCalledWith(mine.endpoint);
    expect(mine.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ログイン: 本人がオンにしたのではない購読は端末でだけやめる(他人のサーバーの行は消さない)', async () => {
    const foreign = fakeSubscription('https://fcm.googleapis.com/fcm/send/foreign', CURRENT);
    installServiceWorker(foreign);
    await releaseForeignPushSubscription(STORAGE_KEY);
    expect(foreign.unsubscribe).toHaveBeenCalled();
    expect(pushApi.unsubscribe).not.toHaveBeenCalled();

    const mine = fakeSubscription('https://fcm.googleapis.com/fcm/send/mine', CURRENT);
    installServiceWorker(mine);
    localStorage.setItem(STORAGE_KEY, mine.endpoint);
    await releaseForeignPushSubscription(STORAGE_KEY);
    expect(mine.unsubscribe).not.toHaveBeenCalled();
  });
});
