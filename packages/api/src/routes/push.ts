import { pushConfigOf, sendTestPush, subscribePush, unsubscribePush } from '@katahimo/core/usecases';
import {
  okResponseSchema,
  pushConfigResponseSchema,
  pushSubscribeRequestSchema,
  pushTestResponseSchema,
  pushUnsubscribeRequestSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { enforceStaffQuota } from '../http/quota';
import { jsonOk, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireSession } from '../session';

/**
 * Web Push 通知(設定画面の「通知」)。購読の登録・削除・テスト通知は、ログイン中のスタッフ本人の端末だけを扱う
 * (要求の本体にスタッフの指定は無い)。送信は outbox に積み、ワーカーが送る。
 */
export function createPushRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 通知を使えるか(VAPID の設定があるか)と、購読に使う VAPID の公開鍵。 */
  app.get('/config', requireSession(container), (c) =>
    jsonOk(c, pushConfigResponseSchema, pushConfigOf(container)),
  );

  /** この端末の購読を本人の購読として登録する(同じ端末の購読があれば書き直す・付け替える)。 */
  app.post('/subscriptions', requireSession(container, 'push.subscription.save'), async (c) => {
    const body = await parseJsonBody(c, pushSubscribeRequestSchema);
    if (!body.ok) return body.response;
    await subscribePush(container, actorOf(c), {
      endpoint: body.data.endpoint,
      p256dh: body.data.keys.p256dh,
      auth: body.data.keys.auth,
    });
    return jsonOk(c, okResponseSchema, { ok: true });
  });

  /** この端末の購読をやめる(本人の購読だけを消す)。 */
  app.delete('/subscriptions', requireSession(container, 'push.subscription.delete'), async (c) => {
    const body = await parseJsonBody(c, pushUnsubscribeRequestSchema);
    if (!body.ok) return body.response;
    await unsubscribePush(container, actorOf(c), body.data.endpoint);
    return jsonOk(c, okResponseSchema, { ok: true });
  });

  /** 本人の全ての端末にテスト通知を送る(スタッフ単位の回数の上限あり)。 */
  app.post('/test', requireSession(container, 'push.test'), async (c) => {
    const limited = await enforceStaffQuota(
      c,
      container,
      container.rateLimits.pushTestStaff,
      'テスト通知の回数が上限に達しました。しばらく待ってから再度お試しください。',
    );
    if (limited) return limited;
    return jsonOk(c, pushTestResponseSchema, { ok: true, ...(await sendTestPush(container, actorOf(c))) });
  });

  return app;
}
