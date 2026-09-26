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
 * 送る中身は通知の文面(JSON)だけ。404 / 410 は expired、それ以外の 4xx(429 を除く)は rejected を返し、
 * 5xx・429・通信の失敗は例外にする(再試行する)。例外の文言には endpoint を入れない(outbox の last_error に残るため)。
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
      return { status: 'delivered' };
    } catch (error) {
      if (error instanceof webpush.WebPushError) {
        const { statusCode } = error;
        if (EXPIRED_STATUS.has(statusCode)) return { status: 'expired', statusCode };
        // 4xx(429 を除く)は鍵・中身・購読の不整合で、送り直しても直らない
        if (statusCode >= 400 && statusCode < 500 && statusCode !== 429)
          return { status: 'rejected', statusCode };
        throw new Error(
          `プッシュサービスが ${statusCode} を返しました: ${String(error.body ?? '').slice(0, 200)}`,
        );
      }
      throw new Error(
        `プッシュサービスに送れませんでした: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
