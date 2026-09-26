import { type PushNotice, pushNoticeSchema } from '@katahimo/shared';
import {
  buildRouteNotice,
  buildTestNotice,
  DomainError,
  newId,
  outboxDedupeKey,
  PermanentOutboxError,
  pushTtlSeconds,
  routeNoticeExpiresAt,
  routeNoticeTopic,
  selectRouteNoticeTargets,
  TEST_NOTICE_VALID_MS,
  tomorrowInTimeZone,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { ClaimedOutboxMessage } from '../ports/outbox';
import type { PushSubscriptionRecord, WebPushSenderPort } from '../ports/push';
import type { TenantDirectoryPort, TenantRecord } from '../ports/tenants';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';
import { getScheduleForStaff, type ScheduleDeps } from './schedule';

/**
 * Web Push 通知(翌日の予定のお知らせ・テスト通知)。購読の登録・削除は本人の端末だけ(API はセッションのスタッフを
 * 渡す)。送信は outbox(push.route_notice / push.test)に積み、ワーカーが送る。VAPID の設定が無い環境では使えない。
 */

export interface PushSubscriptionDeps extends Clock {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
  /** VAPID の公開鍵。null なら Web Push は使えない(設定画面は通知の欄を出さない)。 */
  pushPublicKey: string | null;
}

export const PUSH_DISABLED_MESSAGE = 'この環境では通知を使えません。';
export const PUSH_NOT_SUBSCRIBED_MESSAGE =
  '通知を受け取る端末が登録されていません。先に「翌日の予定を通知する」をオンにしてください。';
/** user_agent 列に残す長さの上限(端末の見分けにだけ使う)。 */
const USER_AGENT_MAX_CHARS = 300;
/** 1人が持てる購読(端末)の数の上限。超えたら最近使っていない(updated_at の古い)ものから消す。 */
export const MAX_PUSH_SUBSCRIPTIONS_PER_STAFF = 10;
/** プッシュサービスに続けて断られたら購読を消す回数(404 / 410 はすぐ消す)。 */
export const PUSH_REJECTION_LIMIT = 3;

function assertPushEnabled(deps: PushSubscriptionDeps): void {
  if (!deps.pushPublicKey) {
    throw new DomainError('validation_failed', PUSH_DISABLED_MESSAGE, undefined, 'push_disabled');
  }
}

/** GET /api/push/config。 */
export function pushConfigOf(deps: Pick<PushSubscriptionDeps, 'pushPublicKey'>) {
  return { enabled: deps.pushPublicKey !== null, publicKey: deps.pushPublicKey };
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * この端末(endpoint)の購読を本人の購読として登録する。同じ endpoint が既にあれば鍵を書き直し、別のスタッフの
 * ものなら本人に付け替える(同じ端末で別のスタッフがログインして通知をオンにした場合)。1人の購読は
 * MAX_PUSH_SUBSCRIPTIONS_PER_STAFF 件までで、超えた分は最近使っていないものから消す。
 */
export async function subscribePush(
  deps: PushSubscriptionDeps,
  actor: Actor,
  input: PushSubscriptionInput,
): Promise<void> {
  assertPushEnabled(deps);
  const userAgent = actor.meta?.userAgent?.slice(0, USER_AGENT_MAX_CHARS) ?? null;
  const { saved, previousStaffId, trimmed } = await deps.uow.run(
    actor.tenantId,
    async (r) => {
      const existing = await r.pushSubscriptions.findByEndpoint(input.endpoint);
      const saved = await r.pushSubscriptions.upsert({
        id: newId(),
        staffId: actor.staffId,
        userAgent,
        ...input,
      });
      const trimmed = await r.pushSubscriptions.trimForStaff(actor.staffId, MAX_PUSH_SUBSCRIPTIONS_PER_STAFF);
      return { saved, previousStaffId: existing?.staffId ?? null, trimmed };
    },
    { actorId: actor.staffId },
  );
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'push.subscription.saved',
    actorStaffId: actor.staffId,
    details: {
      subscriptionId: saved.id,
      created: previousStaffId === null,
      ...(previousStaffId !== null && previousStaffId !== actor.staffId ? { previousStaffId } : {}),
      ...(trimmed > 0 ? { trimmed } : {}),
    },
    ...actor.meta,
  });
}

/** この端末の購読をやめる(本人の購読だけを消す。無ければ何もしない)。VAPID の設定が無くても消せる。 */
export async function unsubscribePush(
  deps: PushSubscriptionDeps,
  actor: Actor,
  endpoint: string,
): Promise<void> {
  const deletedId = await deps.uow.run(
    actor.tenantId,
    (r) => r.pushSubscriptions.deleteForStaff(actor.staffId, endpoint),
    { actorId: actor.staffId },
  );
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'push.subscription.deleted',
    actorStaffId: actor.staffId,
    details: { subscriptionId: deletedId, deleted: deletedId !== null },
    ...actor.meta,
  });
}

/**
 * outbox の push.* のペイロード。1件のメッセージは1つの購読(端末)に送る(失敗した端末だけを送り直すため)。
 * expiresAt を過ぎたら送らない。TTL は送る時点の expiresAt までの残り。
 */
export interface PushOutboxPayload {
  staffId: string;
  subscriptionId: string;
  notice: PushNotice;
  /** ISO 8601。 */
  expiresAt: string;
  topic: string;
}

function pushPayload(payload: PushOutboxPayload): Record<string, unknown> {
  return { ...payload };
}

function parsePushPayload(payload: Record<string, unknown>): PushOutboxPayload | null {
  const notice = pushNoticeSchema.safeParse(payload.notice);
  const { staffId, subscriptionId, expiresAt, topic } = payload;
  if (!notice.success || typeof staffId !== 'string' || typeof subscriptionId !== 'string') return null;
  if (typeof topic !== 'string' || typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)))
    return null;
  return { staffId, subscriptionId, notice: notice.data, expiresAt, topic };
}

/**
 * スタッフの全ての購読に、購読ごとに1件ずつ積む。dedupeVersion は同じ知らせを表す版(お知らせは `<スタッフID>:<日付>`、
 * テストは押すたびに新しい値)。1件でも新しく積めたら true。
 */
async function enqueueForSubscriptions(
  r: TenantRepositories,
  topic: 'push.route_notice' | 'push.test',
  subscriptions: readonly PushSubscriptionRecord[],
  dedupeVersion: string,
  message: Omit<PushOutboxPayload, 'subscriptionId' | 'staffId'>,
): Promise<boolean> {
  let inserted = false;
  for (const subscription of subscriptions) {
    const queued = await r.outbox.enqueue({
      topic,
      aggregateType: 'push_subscription',
      aggregateId: subscription.id,
      dedupeKey: outboxDedupeKey(topic, subscription.id, dedupeVersion),
      payload: pushPayload({ ...message, staffId: subscription.staffId, subscriptionId: subscription.id }),
    });
    inserted ||= queued;
  }
  return inserted;
}

/** 本人の全ての端末にテスト通知を送る(outbox に積む)。送る端末の数を返す。 */
export async function sendTestPush(
  deps: PushSubscriptionDeps,
  actor: Actor,
): Promise<{ subscriptionCount: number }> {
  assertPushEnabled(deps);
  const now = currentTime(deps);
  const subscriptionCount = await deps.uow.run(
    actor.tenantId,
    async (r) => {
      const subscriptions = await r.pushSubscriptions.listForStaff(actor.staffId);
      // テストは押すたびに送る(回数は API のレート制限で抑える)
      await enqueueForSubscriptions(r, 'push.test', subscriptions, `${actor.staffId}:${newId()}`, {
        notice: buildTestNotice(),
        expiresAt: new Date(now.getTime() + TEST_NOTICE_VALID_MS).toISOString(),
        topic: 'test',
      });
      return subscriptions.length;
    },
    { actorId: actor.staffId },
  );
  if (subscriptionCount === 0) {
    throw new DomainError('validation_failed', PUSH_NOT_SUBSCRIBED_MESSAGE, undefined, 'push_not_subscribed');
  }
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'push.test.queued',
    actorStaffId: actor.staffId,
    details: { subscriptionCount },
    ...actor.meta,
  });
  return { subscriptionCount };
}

// ─────────────────────────────────────────────────────────────
// 送信(ワーカーの outbox の処理)
// ─────────────────────────────────────────────────────────────

export interface PushSendDeps extends Clock {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
  webPush: WebPushSenderPort;
}

/**
 * outbox の push.* を1件(1つの購読)送る。
 * - 購読が消えている・別のスタッフに付け替わっている・期限(expiresAt)を過ぎた: 送らずに完了(付け替わった端末に
 *   前の人の予定を出さない。当日に「明日の予定」を出さない)。
 * - 受け付けられた: 最後の成功時刻を残し、断られた回数を0に戻す。
 * - 404 / 410(購読はもう無い): 購読を消す。
 * - それ以外の 4xx(429 を除く): 送り直しても直らないため再試行しない。断られた回数を数え、PUSH_REJECTION_LIMIT 回
 *   続いたら購読を消す。
 * - 5xx・429・通信の失敗: 失敗の時刻を残して例外を投げ、outbox の再試行で**この購読にだけ**送り直す。
 */
export async function sendPushNotice(deps: PushSendDeps, message: ClaimedOutboxMessage): Promise<void> {
  const payload = parsePushPayload(message.payload);
  if (!payload) throw new PermanentOutboxError('Web Push のペイロードが正しくありません');
  const log = (level: 'INFO' | 'WARN', action: string, details: Record<string, unknown>) =>
    deps.appLog.write({
      tenantId: message.tenantId,
      level,
      action,
      actorType: 'system',
      targetStaffId: payload.staffId,
      details: { subscriptionId: payload.subscriptionId, messageId: message.id, ...details },
    });

  const now = currentTime(deps);
  const ttlSeconds = pushTtlSeconds(new Date(payload.expiresAt), now);
  if (ttlSeconds === 0) {
    await log('INFO', 'push.notice.expired', { topic: message.topic, expiresAt: payload.expiresAt });
    return;
  }
  const subscription = await deps.uow.run(message.tenantId, (r) =>
    r.pushSubscriptions.findById(payload.subscriptionId),
  );
  if (!subscription || subscription.staffId !== payload.staffId) return;

  let result: Awaited<ReturnType<WebPushSenderPort['send']>>;
  try {
    result = await deps.webPush.send(subscription, payload.notice, { ttlSeconds, topic: payload.topic });
  } catch (error) {
    await deps.uow.run(message.tenantId, (r) =>
      r.pushSubscriptions.recordRetryableFailure(subscription.id, currentTime(deps)),
    );
    throw error;
  }
  const at = currentTime(deps);
  if (result.status === 'delivered') {
    await deps.uow.run(message.tenantId, (r) => r.pushSubscriptions.recordSuccess(subscription.id, at));
    return;
  }
  if (result.status === 'expired') {
    await deps.uow.run(message.tenantId, (r) => r.pushSubscriptions.delete(subscription.id));
    await log('INFO', 'push.subscription.expired', { statusCode: result.statusCode });
    return;
  }
  const rejections = await deps.uow.run(message.tenantId, async (r) => {
    const count = await r.pushSubscriptions.recordRejection(subscription.id, at);
    if (count >= PUSH_REJECTION_LIMIT) await r.pushSubscriptions.delete(subscription.id);
    return count;
  });
  await log('WARN', 'push.subscription.rejected', {
    statusCode: result.statusCode,
    rejections,
    deleted: rejections >= PUSH_REJECTION_LIMIT,
  });
}

// ─────────────────────────────────────────────────────────────
// 夜間ジョブ: 翌日の予定のお知らせ
// ─────────────────────────────────────────────────────────────

export interface RouteNoticeDeps extends ScheduleDeps, Clock {
  tenants: TenantDirectoryPort;
}

export interface RouteNoticeStaffFailure {
  staffId: string;
  error: string;
}

export interface RouteNoticeTenantSummary {
  tenantId: string;
  tenantSlug: string;
  /** お知らせする日(既定はテナントのタイムゾーンの明日)。 */
  date: string;
  /** 在籍していて購読を持つスタッフの数。 */
  targetCount: number;
  /** お知らせを新しく積んだスタッフの数。 */
  queued: number;
  /** 同じ日のお知らせを全ての端末に積み済みだったスタッフの数(流し直し)。 */
  alreadyQueued: number;
  /** 予定が無いため送らなかったスタッフの数。 */
  noEvents: number;
  failed: number;
  failures: RouteNoticeStaffFailure[];
  interrupted: boolean;
  /** テナント単位で処理できなかった場合の理由。 */
  error?: string;
}

export interface RouteNoticeSummary {
  tenants: RouteNoticeTenantSummary[];
  queued: number;
  alreadyQueued: number;
  failed: number;
  interrupted: boolean;
}

/**
 * 1テナント分: date に在籍していて通知の購読を持つスタッフごとに、date の予定(ルートを含まない軽量版。地図 API は
 * 呼ばない)を読み、予定が1件以上あればお知らせを購読ごとに outbox に積む。予定は strict で読む(読めないカレンダーが
 * あれば欠けたまま送らず、そのスタッフを失敗にする。ジョブは失敗で終わり、再試行で積む)。dedupe_key は購読 × スタッフ
 * × 日付のため、流し直しても二重には積まず、あとから通知をオンにした端末にだけ積む。
 */
export async function enqueueRouteNoticesForTenant(
  deps: RouteNoticeDeps,
  tenant: TenantRecord,
  date: string,
  shouldStop: () => boolean = () => false,
): Promise<RouteNoticeTenantSummary> {
  const now = currentTime(deps);
  const tomorrow = date === tomorrowInTimeZone(now, tenant.timezone);
  const expiresAt = routeNoticeExpiresAt(date, tenant.timezone, tomorrow);
  const targets = await deps.uow.run(tenant.id, async (r) =>
    selectRouteNoticeTargets(
      await r.staff.listActiveOn(date),
      await r.pushSubscriptions.listSubscribedStaffIds(),
    ),
  );
  const summary: RouteNoticeTenantSummary = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    date,
    targetCount: targets.length,
    queued: 0,
    alreadyQueued: 0,
    noEvents: 0,
    failed: 0,
    failures: [],
    interrupted: false,
  };
  const fail = async (staffId: string, error: string) => {
    summary.failed++;
    summary.failures.push({ staffId, error });
    await deps.appLog.write({
      tenantId: tenant.id,
      level: 'ERROR',
      action: 'push.route_notice.staff_failed',
      actorType: 'system',
      targetStaffId: staffId,
      details: { date, error: error.slice(0, 300) },
    });
  };
  for (const staff of targets) {
    if (shouldStop()) {
      summary.interrupted = true;
      break;
    }
    try {
      const schedule = await getScheduleForStaff(deps, {
        tenantId: tenant.id,
        actorStaffId: null,
        targetStaffId: staff.id,
        date,
        strict: true,
      });
      if (!schedule.success) {
        await fail(staff.id, schedule.message ?? '予定を読めませんでした');
        continue;
      }
      const appointments = schedule.appointments ?? [];
      if (appointments.length === 0) {
        summary.noEvents++;
        continue;
      }
      const inserted = await deps.uow.run(tenant.id, async (r) =>
        enqueueForSubscriptions(
          r,
          'push.route_notice',
          await r.pushSubscriptions.listForStaff(staff.id),
          `${staff.id}:${date}`,
          {
            notice: buildRouteNotice(date, appointments, { tomorrow }),
            expiresAt: expiresAt.toISOString(),
            topic: routeNoticeTopic(date),
          },
        ),
      );
      if (inserted) summary.queued++;
      else summary.alreadyQueued++;
    } catch (error) {
      await fail(staff.id, error instanceof Error ? error.message : String(error));
    }
  }
  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'INFO',
    action: 'push.route_notice.done',
    actorType: 'system',
    details: {
      date,
      targetCount: summary.targetCount,
      queued: summary.queued,
      alreadyQueued: summary.alreadyQueued,
      noEvents: summary.noEvents,
      failed: summary.failed,
      interrupted: summary.interrupted,
    },
  });
  return summary;
}

/**
 * 翌日の予定のお知らせ(GAS版 gas-root-serach の夜間の main() の LINE WORKS DM の置き換え。既定 19:00 JST)。
 * 利用中の全テナントについて、テナントのタイムゾーンの「明日」(または options.date)のお知らせを積む。
 */
export async function runRouteNoticeJob(
  deps: RouteNoticeDeps,
  options: { date?: string; shouldStop?: () => boolean } = {},
): Promise<RouteNoticeSummary> {
  const summaries: RouteNoticeTenantSummary[] = [];
  let interrupted = false;
  for (const tenant of await deps.tenants.listActive()) {
    if (options.shouldStop?.()) {
      interrupted = true;
      break;
    }
    const date = options.date ?? tomorrowInTimeZone(currentTime(deps), tenant.timezone);
    try {
      summaries.push(await enqueueRouteNoticesForTenant(deps, tenant, date, options.shouldStop));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'ERROR',
        action: 'push.route_notice.tenant_failed',
        actorType: 'system',
        details: { date, error: message.slice(0, 300) },
      });
      summaries.push({
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        date,
        targetCount: 0,
        queued: 0,
        alreadyQueued: 0,
        noEvents: 0,
        failed: 1,
        failures: [],
        interrupted: false,
        error: message,
      });
    }
  }
  return {
    tenants: summaries,
    queued: summaries.reduce((n, s) => n + s.queued, 0),
    alreadyQueued: summaries.reduce((n, s) => n + s.alreadyQueued, 0),
    failed: summaries.reduce((n, s) => n + s.failed, 0),
    interrupted: interrupted || summaries.some((s) => s.interrupted),
  };
}
