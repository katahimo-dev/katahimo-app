import { pushApi } from '../../api/push';
import { readStorage, removeStorage } from '../../lib/storage';
import { applicationServerKeyOf } from './pushSupport';

/**
 * この端末(ブラウザ)の通知の購読(PushManager)。Service Worker は vite-plugin-pwa が登録したもの
 * (public/push-sw.js が通知を出す)を使う。
 */

/** Service Worker がまだ登録されていない(開発用のサーバー等)。 */
export class ServiceWorkerMissingError extends Error {
  constructor() {
    super('Service Worker が登録されていません');
    this.name = 'ServiceWorkerMissingError';
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** この端末の今の購読(無ければ null)。 */
export async function currentDeviceSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * VAPID の公開鍵で購読する(購読済みなら同じ購読が返る)。別の鍵で購読していた(サーバーの鍵を作り直した)ときは
 * 古い購読をやめて購読し直す。
 */
export async function subscribeDevice(publicKey: string): Promise<PushSubscription> {
  const reg = await registration();
  if (!reg) throw new ServiceWorkerMissingError();
  const options: PushSubscriptionOptionsInit = {
    userVisibleOnly: true,
    applicationServerKey: applicationServerKeyOf(publicKey),
  };
  try {
    return await reg.pushManager.subscribe(options);
  } catch (error) {
    const existing = await reg.pushManager.getSubscription();
    if (!existing) throw error;
    await existing.unsubscribe();
    return reg.pushManager.subscribe(options);
  }
}

/** ログアウトの前にかける時間の上限(通信が遅くてもログアウトを待たせすぎない)。 */
const STOP_ON_LOGOUT_TIMEOUT_MS = 3000;

/**
 * ログアウトするとき、この端末で本人が通知をオンにしていたらやめる(ログアウトした端末にお客様のお名前を出さない)。
 * 失敗してもログアウトは続ける(サーバーの購読は、次にプッシュサービスが「もう無い」と答えたときに消える)。
 */
export async function stopPushOnThisDevice(storageKey: string): Promise<void> {
  const stop = async () => {
    const subscription = await currentDeviceSubscription();
    if (!subscription || readStorage(storageKey) !== subscription.endpoint) return;
    await pushApi.unsubscribe(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
    removeStorage(storageKey);
  };
  await Promise.race([
    stop().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, STOP_ON_LOGOUT_TIMEOUT_MS)),
  ]);
}
