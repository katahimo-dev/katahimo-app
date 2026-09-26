import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { pushApi } from '../../api/push';
import { STORAGE_KEYS, userStorageKey } from '../../lib/storage';
import { createWrapper, TEST_USER } from '../../test/providers';
import { showErrorToast, showToast } from '../../ui/toast';
import { NotificationSettingsSection } from './NotificationSettingsSection';
import { currentDeviceSubscription, subscribeDevice, subscriptionUsesKey } from './pushDevice';
import { PUSH_AVAILABILITY_MESSAGES, type PushEnvironment, readPushEnvironment } from './pushSupport';
import { PUSH_DISABLED_MESSAGE, PUSH_ENABLED_MESSAGE, PUSH_TEST_SENT_MESSAGE } from './usePushSettings';

vi.mock('../../api/push', () => ({
  pushApi: { config: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), sendTest: vi.fn() },
}));
vi.mock('./pushDevice', () => ({
  currentDeviceSubscription: vi.fn(),
  subscribeDevice: vi.fn(),
  subscriptionUsesKey: vi.fn(),
  releaseForeignPushSubscription: vi.fn(async () => undefined),
  stopPushOnThisDevice: vi.fn(async () => undefined),
}));
vi.mock('./pushSupport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pushSupport')>()),
  readPushEnvironment: vi.fn(),
}));
vi.mock('../../ui/toast', () => ({ showToast: vi.fn(), showErrorToast: vi.fn() }));

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-device';
const storageKey = userStorageKey(STORAGE_KEYS.pushEndpoint, {
  tenantId: TEST_USER.tenantId,
  staffId: TEST_USER.staffId,
});
const supported: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  permission: 'granted',
  isIos: false,
  isStandalone: false,
};

function deviceSubscription(endpoint = ENDPOINT) {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    }),
  } as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };
}

function renderSection() {
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <NotificationSettingsSection open />
    </Wrapper>,
  );
}

const toggle = () => screen.findByRole('switch', { name: '翌日の予定を通知する' });

describe('設定の「通知」', () => {
  beforeEach(() => {
    vi.mocked(pushApi.config).mockResolvedValue({ enabled: true, publicKey: 'BPublicKey' });
    vi.mocked(pushApi.subscribe).mockResolvedValue({ ok: true });
    vi.mocked(pushApi.unsubscribe).mockResolvedValue({ ok: true });
    vi.mocked(readPushEnvironment).mockReturnValue(supported);
    vi.mocked(currentDeviceSubscription).mockResolvedValue(null);
    vi.mocked(subscriptionUsesKey).mockReturnValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('サーバーが通知を使えないときは出さない', async () => {
    vi.mocked(pushApi.config).mockResolvedValue({ enabled: false, publicKey: null });
    const { container } = renderSection();
    await waitFor(() => expect(pushApi.config).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('オンにすると通知の許可を聞き、この端末を購読してサーバーに登録する', async () => {
    const requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    vi.mocked(readPushEnvironment).mockReturnValue({ ...supported, permission: 'default' });
    const subscription = deviceSubscription();
    vi.mocked(subscribeDevice).mockResolvedValue(subscription);
    renderSection();

    const sw = await toggle();
    expect((sw as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'テスト通知を送る' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(sw);

    await waitFor(() => expect((sw as HTMLInputElement).checked).toBe(true));
    expect(requestPermission).toHaveBeenCalled();
    expect(subscribeDevice).toHaveBeenCalledWith('BPublicKey');
    expect(pushApi.subscribe).toHaveBeenCalledWith({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    });
    expect(localStorage.getItem(storageKey)).toBe(ENDPOINT);
    expect(showToast).toHaveBeenCalledWith(PUSH_ENABLED_MESSAGE);
  });

  it('許可を拒否したら購読せず、設定で許可し直す案内を出す', async () => {
    let environment: PushEnvironment = { ...supported, permission: 'default' };
    vi.mocked(readPushEnvironment).mockImplementation(() => environment);
    vi.stubGlobal('Notification', {
      requestPermission: async () => {
        environment = { ...supported, permission: 'denied' };
        return 'denied';
      },
    });
    renderSection();
    fireEvent.click(await toggle());
    expect(await screen.findByText(PUSH_AVAILABILITY_MESSAGES.denied)).toBeTruthy();
    expect(subscribeDevice).not.toHaveBeenCalled();
    expect(((await toggle()) as HTMLInputElement).disabled).toBe(true);
  });

  it('本人がこの端末でオンにしていればオンに見え、オフにするとサーバーの登録と端末の購読をやめる', async () => {
    const subscription = deviceSubscription();
    vi.mocked(currentDeviceSubscription).mockResolvedValue(subscription);
    localStorage.setItem(storageKey, ENDPOINT);
    renderSection();

    const sw = await toggle();
    await waitFor(() => expect((sw as HTMLInputElement).checked).toBe(true));
    fireEvent.click(sw);
    await waitFor(() => expect((sw as HTMLInputElement).checked).toBe(false));
    expect(pushApi.unsubscribe).toHaveBeenCalledWith(ENDPOINT);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(showToast).toHaveBeenCalledWith(PUSH_DISABLED_MESSAGE);
  });

  it('サーバーの鍵を作り直していたら、開いたときに今の鍵で購読し直して登録し直す', async () => {
    const old = deviceSubscription('https://fcm.googleapis.com/fcm/send/old');
    const renewed = deviceSubscription();
    vi.mocked(currentDeviceSubscription).mockResolvedValue(old);
    vi.mocked(subscriptionUsesKey).mockReturnValue(false);
    vi.mocked(subscribeDevice).mockResolvedValue(renewed);
    localStorage.setItem(storageKey, old.endpoint);
    renderSection();
    const sw = await toggle();
    await waitFor(() => expect((sw as HTMLInputElement).checked).toBe(true));
    expect(subscribeDevice).toHaveBeenCalledWith('BPublicKey');
    expect(pushApi.subscribe).toHaveBeenCalledWith(expect.objectContaining({ endpoint: ENDPOINT }));
    expect(localStorage.getItem(storageKey)).toBe(ENDPOINT);
  });

  it('購読し直せなければオフに見せる', async () => {
    vi.mocked(currentDeviceSubscription).mockResolvedValue(deviceSubscription());
    vi.mocked(subscriptionUsesKey).mockReturnValue(false);
    vi.mocked(subscribeDevice).mockRejectedValue(new Error('push service error'));
    localStorage.setItem(storageKey, ENDPOINT);
    renderSection();
    await waitFor(() => expect(subscribeDevice).toHaveBeenCalled());
    const sw = await toggle();
    await waitFor(() => expect((sw as HTMLInputElement).disabled).toBe(false));
    expect((sw as HTMLInputElement).checked).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('続けて押しても1回だけ登録する', async () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: async () => 'granted' });
    vi.mocked(readPushEnvironment).mockReturnValue({ ...supported, permission: 'default' });
    vi.mocked(subscribeDevice).mockResolvedValue(deviceSubscription());
    renderSection();
    const sw = await toggle();
    fireEvent.click(sw);
    fireEvent.click(sw);
    await waitFor(() => expect(pushApi.subscribe).toHaveBeenCalled());
    expect(subscribeDevice).toHaveBeenCalledTimes(1);
  });

  it('同じ端末で別の人がオンにした購読は、本人にはオフに見える', async () => {
    vi.mocked(currentDeviceSubscription).mockResolvedValue(deviceSubscription());
    renderSection();
    const sw = await toggle();
    await waitFor(() => expect(currentDeviceSubscription).toHaveBeenCalled());
    expect((sw as HTMLInputElement).checked).toBe(false);
  });

  it('テスト通知を送る(失敗はサーバーの理由を出す)', async () => {
    vi.mocked(currentDeviceSubscription).mockResolvedValue(deviceSubscription());
    localStorage.setItem(storageKey, ENDPOINT);
    vi.mocked(pushApi.sendTest).mockResolvedValueOnce({ ok: true, subscriptionCount: 1 });
    renderSection();
    const button = await screen.findByRole('button', { name: 'テスト通知を送る' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(PUSH_TEST_SENT_MESSAGE));

    const limited = new ApiRequestError(429, { code: 'rate_limited', message: '上限に達しました' });
    vi.mocked(pushApi.sendTest).mockRejectedValueOnce(limited);
    fireEvent.click(button);
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(limited));
  });

  it('iPhone の Safari では「ホーム画面に追加」の案内を出し、切り替えられない', async () => {
    vi.mocked(readPushEnvironment).mockReturnValue({
      ...supported,
      isIos: true,
      hasPushManager: false,
      permission: null,
    });
    renderSection();
    expect(await screen.findByText(PUSH_AVAILABILITY_MESSAGES.ios_needs_install)).toBeTruthy();
    expect(((await toggle()) as HTMLInputElement).disabled).toBe(true);
  });

  it('対応していないブラウザでは理由を出す', async () => {
    vi.mocked(readPushEnvironment).mockReturnValue({ ...supported, hasServiceWorker: false });
    renderSection();
    expect(await screen.findByText(PUSH_AVAILABILITY_MESSAGES.unsupported)).toBeTruthy();
  });
});
