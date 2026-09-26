import type {
  PushNotice,
  WebPushSenderPort,
  WebPushSendOptions,
  WebPushSendResult,
  WebPushTarget,
} from '@katahimo/core/ports';
import webpush from 'web-push';
import type { VapidDetails } from './webPushConfig';

/** プッシュサービスの応答を待つ時間。 */
const REQUEST_TIMEOUT_MS = 10_000;
/** 購読がもう無い(端末で通知をやめた・期限切れ)ことを表す応答。 */
const EXPIRED_STATUS = new Set([404, 410]);

/**
 * web-push パッケージで Web Push を送る(VAPID の署名 + RFC 8291 の aes128gcm で暗号化)。
 * 送る中身は通知の文面(JSON)だけ。失敗の例外の文言には endpoint を入れない(outbox の last_error に残るため)。
 */
export class WebPushSender implements WebPushSenderPort {
  constructor(private readonly vapid: VapidDetails) {}

  async send(
    target: WebPushTarget,
    notice: PushNotice,
    options: WebPushSendOptions,
  ): Promise<WebPushSendResult> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(notice),
        {
          vapidDetails: this.vapid,
          TTL: options.ttlSeconds,
          topic: options.topic,
          urgency: 'normal',
          contentEncoding: 'aes128gcm',
          timeout: REQUEST_TIMEOUT_MS,
        },
      );
      return 'delivered';
    } catch (error) {
      if (error instanceof webpush.WebPushError) {
        if (EXPIRED_STATUS.has(error.statusCode)) return 'expired';
        throw new Error(`プッシュサービスが ${error.statusCode} を返しました: ${error.body.slice(0, 200)}`);
      }
      throw new Error(
        `プッシュサービスに送れませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
