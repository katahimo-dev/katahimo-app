/**
 * この端末・ブラウザで通知(Web Push)を受け取れるかの判定(画面に依存しない)。
 * iPhone・iPad(iOS / iPadOS 16.4 以降)は「ホーム画面に追加」したアプリからしか Web Push を使えない。
 */

export type PushAvailability =
  /** 受け取れる(通知の許可をまだ聞いていない・許可済み)。 */
  | 'available'
  /** iPhone・iPad の Safari で開いている(ホーム画面に追加したアプリから開けば受け取れる)。 */
  | 'ios_needs_install'
  /** 通知が拒否されている(端末・ブラウザの設定で許可し直す)。 */
  | 'denied'
  /** このブラウザは Web Push に対応していない。 */
  | 'unsupported';

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  /** Notification.permission(Notification が無ければ null)。 */
  permission: NotificationPermission | null;
  isIos: boolean;
  /** ホーム画面に追加したアプリ(standalone)として開いているか。 */
  isStandalone: boolean;
}

export const PUSH_AVAILABILITY_MESSAGES: Record<Exclude<PushAvailability, 'available'>, string> = {
  ios_needs_install:
    'iPhone・iPad では、Safari の共有ボタン（□↑）から「ホーム画面に追加」し、ホーム画面のアプリから開くと通知を受け取れます（iOS 16.4 以降）。',
  denied: '通知が許可されていません。端末（ブラウザ）の設定で、このアプリの通知を許可してください。',
  unsupported: 'このブラウザは通知に対応していません。',
};

/** iPadOS 13 以降の Safari は Mac と名乗るため、タッチ操作できるかで見分ける。 */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function readPushEnvironment(win: Window & typeof globalThis = window): PushEnvironment {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return {
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in win,
    permission: typeof win.Notification === 'function' ? win.Notification.permission : null,
    isIos: isIosDevice(nav.userAgent, nav.platform, nav.maxTouchPoints ?? 0),
    isStandalone: nav.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true,
  };
}

export function pushAvailabilityOf(env: PushEnvironment): PushAvailability {
  if (env.isIos && !env.isStandalone) return 'ios_needs_install';
  if (!env.hasServiceWorker || !env.hasPushManager || env.permission === null) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'available';
}

/** VAPID の公開鍵(base64url)を PushManager.subscribe の applicationServerKey の形にする。 */
export function applicationServerKeyOf(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
