import { pushSubscribeRequestSchema } from '@katahimo/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, NetworkError } from '../../api/client';
import { pushApi } from '../../api/push';
import { readStorage, removeStorage, STORAGE_KEYS, userStorageKey, writeStorage } from '../../lib/storage';
import { showErrorToast, showToast } from '../../ui/toast';
import { useSession } from '../auth';
import { currentDeviceSubscription, subscribeDevice, subscriptionUsesKey } from './pushDevice';
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
  // 押した直後の2回目を止める(state は次の描画まで古い値のため、ref で見る)
  const busyRef = useRef(false);

  /** この端末を今の鍵で購読し、本人の購読としてサーバーに登録する。 */
  const register = useCallback(
    async (key: string) => {
      const subscription = await subscribeDevice(key);
      const request = pushSubscribeRequestSchema.safeParse(subscription.toJSON());
      if (!request.success) {
        await subscription.unsubscribe();
        throw new Error('対応していないプッシュサービスです');
      }
      await pushApi.subscribe(request.data);
      writeStorage(storageKey, subscription.endpoint);
    },
    [storageKey],
  );

  // 開くたびに、この端末の状態(対応・許可・購読)を読み直す(端末の設定で許可を変えることがあるため)。
  // 本人の購読がサーバーの鍵を作り直す前の鍵のものなら、今の鍵で購読し直して登録し直す(許可済みなので聞き直さない)
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
    const refresh = async () => {
      const subscription = await currentDeviceSubscription();
      if (!subscription || readStorage(storageKey) !== subscription.endpoint) return false;
      if (subscriptionUsesKey(subscription, publicKey)) return true;
      await register(publicKey);
      return true;
    };
    busyRef.current = true;
    setBusy(true);
    void refresh()
      .catch(() => {
        removeStorage(storageKey);
        return false;
      })
      .then((on) => {
        if (!cancelled) setEnabledState(on);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, publicKey, storageKey, register]);

  const turnOn = useCallback(
    async (key: string) => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        // 拒否したら設定で許可し直す案内を出す(閉じただけなら、もう一度オンにすれば聞き直す)
        setAvailability(pushAvailabilityOf(readPushEnvironment()));
        return;
      }
      await register(key);
      setEnabledState(true);
      showToast(PUSH_ENABLED_MESSAGE);
    },
    [register],
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
      if (busyRef.current || !publicKey) return;
      busyRef.current = true;
      setBusy(true);
      void (next ? turnOn(publicKey) : turnOff()).catch(showSetupError).finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
    },
    [publicKey, turnOn, turnOff],
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
