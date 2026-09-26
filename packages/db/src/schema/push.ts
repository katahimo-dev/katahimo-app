import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, idColumn, tenantIdColumn, updatedAt } from './_columns';
import { tenantRef, tenantScoped } from './_helpers';
import { staff } from './staff';

/**
 * Web Push の購読(スタッフの端末のブラウザごとに1行)。翌日の予定のお知らせ・テスト通知の送り先。
 * - endpoint はテナントの中で一意。同じ端末で別のスタッフが通知をオンにしたら、そのスタッフの行に付け替える。
 *   endpoint は既知のプッシュサービス(FCM・Mozilla・Apple・Windows)の https の URL だけを受け付ける(API の契約)。
 * - p256dh / auth はブラウザが作った暗号化の鍵(RFC 8291。通知の中身はこの鍵で暗号化して送る)。
 * - プッシュサービスが購読はもう無い(404 / 410)と答えたらワーカーが行を消す。failure_count はそれ以外の 4xx
 *   (429 を除く。送り直しても直らない)で断られた回数の続きで、3回で行を消す(成功・登録し直しで0に戻す)。
 *   5xx・429・通信の失敗は last_failure_at だけを残す(outbox が再試行する)。
 * - 1人10件まで(登録のたびに updated_at の古いものから消す)。退職・スタッフの削除で購読も消える。
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    /** 登録したブラウザの User-Agent(端末の見分けにだけ使う。300文字まで)。 */
    userAgent: text(),
    lastSuccessAt: timestamp({ withTimezone: true }),
    lastFailureAt: timestamp({ withTimezone: true }),
    failureCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('push_subscriptions', t),
    tenantRef('push_subscriptions', 'staff_id', t, t.staffId, staff, 'cascade'),
    unique('push_subscriptions_tenant_id_endpoint_key').on(t.tenantId, t.endpoint),
    index('push_subscriptions_tenant_id_staff_id_idx').on(t.tenantId, t.staffId),
    check('push_subscriptions_endpoint_check', sql`${t.endpoint} like 'https://%'`),
    check('push_subscriptions_failure_count_check', sql`${t.failureCount} >= 0`),
  ],
).enableRLS();
