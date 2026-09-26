import { z } from 'zod';
import { businessDateSchema } from './common';

/**
 * Web Push 通知(翌日の予定のお知らせ・テスト通知)の API(doc/04_API仕様.md)。
 * 購読(PushSubscription)はログイン中のスタッフ本人の端末のものだけを扱う(他のスタッフの購読は登録・削除できない)。
 */

/**
 * 購読の送り先として受け付けるプッシュサービス(ホスト名の末尾)。ワーカーは登録された endpoint へ POST するため、
 * ブラウザのプッシュサービス以外(社内のアドレス・任意のサーバー)を登録させない。
 */
export const PUSH_SERVICE_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
] as const;

/** endpoint が https で、既知のプッシュサービスのホストか。 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** base64url の鍵(末尾の = のパディングは付いていてもよい)。 */
const base64UrlKey = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, '鍵の形式が正しくありません');

export const pushEndpointSchema = z
  .string()
  .max(2048)
  .refine(isAllowedPushEndpoint, '通知の送り先が正しくありません');

/** GET /api/push/config。enabled=false(サーバーに VAPID の設定が無い)なら画面は通知の設定を出さない。 */
export const pushConfigResponseSchema = z.object({
  enabled: z.boolean(),
  /** VAPID の公開鍵(base64url)。PushManager.subscribe の applicationServerKey に渡す。 */
  publicKey: z.string().nullable(),
});
export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>;

/**
 * POST /api/push/subscriptions。PushSubscription.toJSON() の形(expirationTime は使わない)。
 * p256dh は P-256 の公開鍵(65バイト = base64url 87文字)、auth は16バイト(22文字)。
 */
export const pushSubscribeRequestSchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().nullish(),
  keys: z.object({
    p256dh: base64UrlKey(80, 100),
    auth: base64UrlKey(16, 32),
  }),
});
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>;

/** DELETE /api/push/subscriptions(この端末の購読をやめる)。 */
export const pushUnsubscribeRequestSchema = z.object({ endpoint: pushEndpointSchema });
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeRequestSchema>;

/** POST /api/push/test の応答(送る端末の数)。送信はワーカーが outbox から行う。 */
export const pushTestResponseSchema = z.object({ ok: z.literal(true), subscriptionCount: z.number().int() });
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;

/**
 * Service Worker が受け取る通知の中身(暗号化されて届く。RFC 8291)。表示名と時刻だけを入れ、住所・電話番号は入れない。
 * url は同じオリジンのパス(通知を押したときに開く)。tag が同じ通知は端末の上で置き換わる(再送で二重に出ない)。
 */
export const pushNoticeSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().max(1000),
  url: z.string().startsWith('/'),
  tag: z.string().min(1).max(64),
});
export type PushNotice = z.infer<typeof pushNoticeSchema>;

/** 予定タブを開く URL の問い合わせの名前(`/?schedule=YYYY-MM-DD`)。 */
export const SCHEDULE_LINK_PARAM = 'schedule';

/** 予定タブで date の予定を開く URL(通知を押したときに開く)。 */
export function scheduleLinkPath(date: string): string {
  return `/?${SCHEDULE_LINK_PARAM}=${date}`;
}

/** URL の問い合わせ(location.search)から、予定タブで開く日付を読む(無い・形が違えば null)。 */
export function scheduleLinkDateOf(search: string): string | null {
  const value = new URLSearchParams(search).get(SCHEDULE_LINK_PARAM);
  return value !== null && businessDateSchema.safeParse(value).success ? value : null;
}
