import { afterEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { vapidDetailsOf, vapidEnvProblems, vapidPublicKeySchema, vapidSenderEnvShape } from './webPushConfig';
import { WebPushSender } from './webPushSender';

const vapid = { ...webpush.generateVAPIDKeys(), subject: 'mailto:ops@example.com' };
const target = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-secret-id',
  p256dh: 'p'.repeat(87),
  auth: 'a'.repeat(22),
};
const notice = {
  title: '明日の予定 9/27(日) 1件',
  body: '10:00〜12:00 山田 花子様',
  url: '/?schedule=2026-09-27',
  tag: 't',
};
const options = { ttlSeconds: 3600, topic: 'route-20260927' };

const pushError = (statusCode: number) =>
  new webpush.WebPushError('Received unexpected response code', statusCode, {}, 'body text', target.endpoint);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebPushSender', () => {
  it('VAPID・TTL・topic を付け、通知の文面を JSON で aes128gcm で送る', async () => {
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    expect(await new WebPushSender(vapid).send(target, notice, options)).toEqual({ status: 'delivered' });
    expect(send).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(notice),
      expect.objectContaining({
        vapidDetails: vapid,
        TTL: 3600,
        topic: 'route-20260927',
        contentEncoding: 'aes128gcm',
      }),
    );
  });

  it('404・410 は購読がもう無い(expired)', async () => {
    const sender = new WebPushSender(vapid);
    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(pushError(410));
    expect(await sender.send(target, notice, options)).toEqual({ status: 'expired', statusCode: 410 });
    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(pushError(404));
    expect(await sender.send(target, notice, options)).toEqual({ status: 'expired', statusCode: 404 });
  });

  it('それ以外の 4xx(400・401・403・413)は送り直しても直らない(rejected)。429 は再試行する', async () => {
    const sender = new WebPushSender(vapid);
    for (const statusCode of [400, 401, 403, 413]) {
      vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(pushError(statusCode));
      expect(await sender.send(target, notice, options)).toEqual({ status: 'rejected', statusCode });
    }
    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(pushError(429));
    await expect(sender.send(target, notice, options)).rejects.toThrow('プッシュサービスが 429 を返しました');
  });

  it('それ以外の失敗は例外にする(文言に endpoint を入れない)', async () => {
    const sender = new WebPushSender(vapid);
    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(pushError(503));
    await expect(sender.send(target, notice, options)).rejects.toThrow('プッシュサービスが 503 を返しました');
    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(new Error('socket hang up'));
    const error = await sender.send(target, notice, options).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('device-secret-id');
  });

  it('実際の暗号化(RFC 8291)で要求を組み立てられる(本文は平文を含まない)', () => {
    const subscriber = webpush.generateVAPIDKeys();
    const details = webpush.generateRequestDetails(
      {
        endpoint: target.endpoint,
        // 購読側の鍵(P-256 の公開鍵 65バイトと auth 16バイト)
        keys: { p256dh: subscriber.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') },
      },
      JSON.stringify(notice),
      { vapidDetails: vapid, TTL: 60, contentEncoding: 'aes128gcm' },
    );
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(details.headers.Authorization)).toMatch(/^vapid t=/);
    expect(details.body?.toString('utf8')).not.toContain('山田');
  });
});

describe('VAPID の設定', () => {
  it('鍵の長さを確かめる', () => {
    expect(vapidPublicKeySchema.safeParse(vapid.publicKey).success).toBe(true);
    expect(vapidPublicKeySchema.safeParse('').data).toBeUndefined();
    expect(vapidPublicKeySchema.safeParse(vapid.privateKey).success).toBe(false);
    expect(vapidSenderEnvShape.VAPID_PRIVATE_KEY.safeParse(vapid.privateKey).success).toBe(true);
    expect(vapidSenderEnvShape.VAPID_PRIVATE_KEY.safeParse(vapid.publicKey).success).toBe(false);
    expect(vapidSenderEnvShape.VAPID_SUBJECT.safeParse('mailto:ops@example.com').success).toBe(true);
    expect(vapidSenderEnvShape.VAPID_SUBJECT.safeParse('ops@example.com').success).toBe(false);
  });

  it('3つ揃っているか、どれも無いか', () => {
    const all = {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: vapid.subject,
    };
    expect(vapidEnvProblems(all)).toEqual([]);
    expect(vapidEnvProblems({})).toEqual([]);
    expect(vapidEnvProblems({ VAPID_PUBLIC_KEY: vapid.publicKey })).toHaveLength(1);
    expect(vapidDetailsOf(all)).toEqual(vapid);
    expect(vapidDetailsOf({ VAPID_PUBLIC_KEY: vapid.publicKey })).toBeNull();
  });
});
