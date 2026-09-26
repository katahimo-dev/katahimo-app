import { pushSubscribeRequestSchema } from '@katahimo/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, NetworkError } from '../../api/client';
import { pushApi } from '../../api/push';
import { readStorage, removeStorage, STORAGE_KEYS, userStorageKey, writeStorage } from '../../lib/storage';
import { showErrorToast, showToast } from '../../ui/toast';
import { useSession } from '../auth';
import { currentDeviceSubscription, subscribeDevice } from './pushDevice';
import { type PushAvailability, pushAvailabilityOf, readPushEnvironment } from './pushSupport';

export const PUSH_ENABLED_MESSAGE = '翌日の予定を通知します';
export const PUSH_DISABLED_MESSAGE = '通知をオフにしました';
export const PUSH_TEST_SENT_MESSAGE = 'テスト通知を送りました。まもなく届きます。';
export const PUSH_SETUP_FAILED_MESSAGE = '通知を設定できませんでした。もう一度お試しください。';

export interface PushSettings {
  /** サーバーが通知を使える(VAPID の設定がある)。false なら設定の欄を出さない。 */
  visible: boolean;
  availability: PushAvailability;
  /** この端末で本人の通知がオンか。 */
  enabled: boolean;
  /** オン・オフの切り替え中。 */
  busy: boolean;
  testing: boolean;
  setEnabled: (next: boolean) => void;
  sendTest: () => void;
}

export const pushConfigQueryKey = ['push', 'config'] as const;

function showSetupError(error: unknown) {
  if (error instanceof ApiRequestError || error instanceof NetworkError) {
    showErrorToast(error);
    return;
  }
  console.error('通知を設定できませんでした', error);
  showToast(PUSH_SETUP_FAILED_MESSAGE, true);
}

/**
 * 設定画面の「通知」。オンにすると通知の許可を聞き、この端末を VAPID の公開鍵で購読してサーバーに登録する。
 * オフにするとサーバーの登録と端末の購読をやめる。この端末の購読が本人のものかは、オンにしたときの endpoint を
 * 本人のキー(userStorageKey)に覚えて見分ける(同じ端末で別の人がオンにしていたら、本人にはオフに見える)。
 */
export function usePushSettings(open: boolean): PushSettings {
  const { storageScope } = useSession();
  const storageKey = userStorageKey(STORAGE_KEYS.pushEndpoint, storageScope);
  const config = useQuery({
    queryKey: pushConfigQueryKey,
    queryFn: ({ signal }) => pushApi.config(signal),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const publicKey = config.data?.enabled ? config.data.publicKey : null;
  const [availability, setAvailability] = useState<PushAvailability>(() =>
    pushAvailabilityOf(readPushEnvironment()),
  );
  const [enabled, setEnabledState] = useState(false);
  const [busy, setBusy] = useState(false);

  // 開くたびに、この端末の状態(対応・許可・購読)を読み直す(端末の設定で許可を変えることがあるため)
  useEffect(() => {
    if (!open || !publicKey) return;
    let cancelled = false;
    const environment = readPushEnvironment();
    const next = pushAvailabilityOf(environment);
    setAvailability(next);
    if (next !== 'available' || environment.permission !== 'granted') {
      setEnabledState(false);
      return;
    }
    currentDeviceSubscription()
      .then((subscription) => {
        if (!cancelled)
          setEnabledState(subscription !== null && readStorage(storageKey) === subscription.endpoint);
      })
      .catch(() => {
        if (!cancelled) setEnabledState(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, publicKey, storageKey]);

  const turnOn = useCallback(
    async (key: string) => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        // 拒否したら設定で許可し直す案内を出す(閉じただけなら、もう一度オンにすれば聞き直す)
        setAvailability(pushAvailabilityOf(readPushEnvironment()));
        return;
      }
      const subscription = await subscribeDevice(key);
      const request = pushSubscribeRequestSchema.safeParse(subscription.toJSON());
      if (!request.success) {
        await subscription.unsubscribe();
        throw new Error('対応していないプッシュサービスです');
      }
      await pushApi.subscribe(request.data);
      writeStorage(storageKey, subscription.endpoint);
      setEnabledState(true);
      showToast(PUSH_ENABLED_MESSAGE);
    },
    [storageKey],
  );

  const turnOff = useCallback(async () => {
    const subscription = await currentDeviceSubscription();
    if (subscription) {
      await pushApi.unsubscribe(subscription.endpoint);
      await subscription.unsubscribe();
    }
    removeStorage(storageKey);
    setEnabledState(false);
    showToast(PUSH_DISABLED_MESSAGE);
  }, [storageKey]);

  const setEnabled = useCallback(
    (next: boolean) => {
      if (busy || !publicKey) return;
      setBusy(true);
      void (next ? turnOn(publicKey) : turnOff()).catch(showSetupError).finally(() => setBusy(false));
    },
    [busy, publicKey, turnOn, turnOff],
  );

  const test = useMutation({
    mutationFn: () => pushApi.sendTest(),
    onSuccess: () => showToast(PUSH_TEST_SENT_MESSAGE),
    onError: (error) => showErrorToast(error),
  });
  const { mutate } = test;
  const sendTest = useCallback(() => mutate(), [mutate]);

  return {
    visible: publicKey !== null,
    availability,
    enabled,
    busy,
    testing: test.isPending,
    setEnabled,
    sendTest,
  };
}
