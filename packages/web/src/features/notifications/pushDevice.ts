import { pushApi } from '../../api/push';
import { getBrowserStorage, readStorage, removeStorage } from '../../lib/storage';
import { applicationServerKeyOf, usesApplicationServerKey } from './pushSupport';

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

/** 購読が今の VAPID の公開鍵で作られたものか(サーバーの鍵を作り直したら false)。 */
export function subscriptionUsesKey(subscription: PushSubscription, publicKey: string): boolean {
  return usesApplicationServerKey(subscription.options.applicationServerKey, publicKey);
}

/**
 * VAPID の公開鍵で購読する(同じ鍵の購読があればそれを返す)。別の鍵で購読していた(サーバーの鍵を作り直した)ときは、
 * 古い購読をサーバーから消し、端末の購読もやめてから購読し直す。
 */
export async function subscribeDevice(publicKey: string): Promise<PushSubscription> {
  const reg = await registration();
  if (!reg) throw new ServiceWorkerMissingError();
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    if (subscriptionUsesKey(existing, publicKey)) return existing;
    await pushApi.unsubscribe(existing.endpoint).catch(() => undefined);
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKeyOf(publicKey),
  });
}

/** ログアウトの前にかける時間の上限(通信が遅くてもログアウトを待たせすぎない)。 */
const STOP_ON_LOGOUT_TIMEOUT_MS = 3000;

/**
 * ログアウトするとき(ログアウトの API より前)、この端末で本人が通知をオンにしていたらやめる(ログアウトした端末に
 * お客様のお名前を出さない)。失敗してもログアウトは続ける(サーバーの購読は、次にプッシュサービスが「もう無い」と
 * 答えたときに消える)。
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

/**
 * ログインしたとき、この端末に本人がオンにしたのではない購読(前にこの端末を使った別の人のもの)があれば、端末の購読を
 * やめる(その人の予定のお知らせがこの端末に出続けないように)。サーバーの行は他人のものなので消さない(次の送信で
 * プッシュサービスが「もう無い」と答え、ワーカーが消す)。localStorage が使えない端末では見分けられないため何もしない。
 */
export async function releaseForeignPushSubscription(storageKey: string): Promise<void> {
  if (!getBrowserStorage()) return;
  try {
    const subscription = await currentDeviceSubscription();
    if (subscription && readStorage(storageKey) !== subscription.endpoint) await subscription.unsubscribe();
  } catch {
    // 端末の購読を読めない・やめられないときは何もしない
  }
}
