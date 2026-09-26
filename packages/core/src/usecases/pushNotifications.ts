import { type PushNotice, pushNoticeSchema } from '@katahimo/shared';
import {
  buildRouteNotice,
  buildTestNotice,
  DomainError,
  newId,
  outboxDedupeKey,
  PermanentOutboxError,
  ROUTE_NOTICE_TTL_SECONDS,
  routeNoticeTopic,
  selectRouteNoticeTargets,
  TEST_NOTICE_TTL_SECONDS,
  tomorrowInTimeZone,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { ClaimedOutboxMessage } from '../ports/outbox';
import type { PushSubscriptionRecord, WebPushSenderPort, WebPushSendResult } from '../ports/push';
import type { TenantDirectoryPort, TenantRecord } from '../ports/tenants';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
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
 * ものなら本人に付け替える(同じ端末で別のスタッフがログインして通知をオンにした場合)。
 */
export async function subscribePush(
  deps: PushSubscriptionDeps,
  actor: Actor,
  input: PushSubscriptionInput,
): Promise<void> {
  assertPushEnabled(deps);
  const userAgent = actor.meta?.userAgent?.slice(0, USER_AGENT_MAX_CHARS) ?? null;
  const { saved, previousStaffId } = await deps.uow.run(
    actor.tenantId,
    async (r) => {
      const existing = await r.pushSubscriptions.findByEndpoint(input.endpoint);
      const saved = await r.pushSubscriptions.upsert({
        id: newId(),
        staffId: actor.staffId,
        userAgent,
        ...input,
      });
      return { saved, previousStaffId: existing?.staffId ?? null };
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

/** outbox の push.* のペイロード(送る相手・通知の文面・プッシュサービスへの指定)。 */
export interface PushOutboxPayload {
  staffId: string;
  notice: PushNotice;
  ttlSeconds: number;
  topic: string;
}

function pushPayload(payload: PushOutboxPayload): Record<string, unknown> {
  return { ...payload };
}

function parsePushPayload(payload: Record<string, unknown>): PushOutboxPayload | null {
  const notice = pushNoticeSchema.safeParse(payload.notice);
  const { staffId, ttlSeconds, topic } = payload;
  if (!notice.success || typeof staffId !== 'string' || typeof topic !== 'string') return null;
  if (typeof ttlSeconds !== 'number' || !Number.isInteger(ttlSeconds) || ttlSeconds < 0) return null;
  return { staffId, notice: notice.data, ttlSeconds, topic };
}

/** 本人の全ての端末にテスト通知を送る(outbox に積む)。送る端末の数を返す。 */
export async function sendTestPush(
  deps: PushSubscriptionDeps,
  actor: Actor,
): Promise<{ subscriptionCount: number }> {
  assertPushEnabled(deps);
  const subscriptionCount = await deps.uow.run(
    actor.tenantId,
    async (r) => {
      const subscriptions = await r.pushSubscriptions.listForStaff(actor.staffId);
      if (subscriptions.length === 0) return 0;
      await r.outbox.enqueue({
        topic: 'push.test',
        aggregateType: 'staff',
        aggregateId: actor.staffId,
        // テストは押すたびに送る(回数は API のレート制限で抑える)
        dedupeKey: outboxDedupeKey('push.test', actor.staffId, newId()),
        payload: pushPayload({
          staffId: actor.staffId,
          notice: buildTestNotice(),
          ttlSeconds: TEST_NOTICE_TTL_SECONDS,
          topic: 'test',
        }),
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

type SendOutcome = { subscription: PushSubscriptionRecord } & (
  | { result: WebPushSendResult }
  | { error: string }
);

/**
 * outbox の push.* を1件送る: そのスタッフの全ての購読へ送り、受け付けられた購読は最後の成功時刻を、失敗した購読は
 * 失敗の回数を記録する。プッシュサービスが購読はもう無い(404 / 410)と答えたら購読を消す。1つでも失敗(それ以外)が
 * あれば例外を投げ、outbox の再試行の方針で送り直す(同じ tag の通知は端末の上で置き換わるため二重には出ない)。
 */
export async function sendPushNotice(deps: PushSendDeps, message: ClaimedOutboxMessage): Promise<void> {
  const payload = parsePushPayload(message.payload);
  if (!payload) throw new PermanentOutboxError('Web Push のペイロードが正しくありません');
  const subscriptions = await deps.uow.run(message.tenantId, (r) =>
    r.pushSubscriptions.listForStaff(payload.staffId),
  );
  const outcomes: SendOutcome[] = [];
  for (const subscription of subscriptions) {
    try {
      const result = await deps.webPush.send(subscription, payload.notice, {
        ttlSeconds: payload.ttlSeconds,
        topic: payload.topic,
      });
      outcomes.push({ subscription, result });
    } catch (e) {
      outcomes.push({ subscription, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (outcomes.length === 0) return;

  const at = currentTime(deps);
  await deps.uow.run(message.tenantId, async (r) => {
    for (const outcome of outcomes) {
      const { id } = outcome.subscription;
      if ('error' in outcome) await r.pushSubscriptions.recordFailure(id, at);
      else if (outcome.result === 'expired') await r.pushSubscriptions.delete(id);
      else await r.pushSubscriptions.recordSuccess(id, at);
    }
  });
  for (const outcome of outcomes) {
    if ('result' in outcome && outcome.result === 'expired') {
      await deps.appLog.write({
        tenantId: message.tenantId,
        level: 'INFO',
        action: 'push.subscription.expired',
        actorType: 'system',
        targetStaffId: payload.staffId,
        details: { subscriptionId: outcome.subscription.id, messageId: message.id },
      });
    }
  }
  const failures = outcomes.filter((o): o is Extract<SendOutcome, { error: string }> => 'error' in o);
  const [first] = failures;
  if (first) {
    throw new Error(`Web Push の送信に失敗しました(${failures.length}/${outcomes.length}件): ${first.error}`);
  }
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
  /** お知らせする日(テナントのタイムゾーンの明日)。 */
  date: string;
  /** 在籍していて購読を持つスタッフの数。 */
  targetCount: number;
  /** お知らせを積んだスタッフの数(同じ日に積み済みのものは積み直さない)。 */
  queued: number;
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
  failed: number;
  interrupted: boolean;
}

/**
 * 1テナント分: date に在籍していて通知の購読を持つスタッフごとに、date の予定(ルートを含まない軽量版。地図 API は
 * 呼ばない)を読み、予定が1件以上あればお知らせを outbox に積む。dedupe_key はスタッフ × 日付
 * (`push.route_notice:<スタッフID>:<日付>`)のため、ジョブを流し直しても二重には積まない。
 */
export async function enqueueRouteNoticesForTenant(
  deps: RouteNoticeDeps,
  tenant: TenantRecord,
  date: string,
  shouldStop: () => boolean = () => false,
): Promise<RouteNoticeTenantSummary> {
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
      await deps.uow.run(tenant.id, (r) =>
        r.outbox.enqueue({
          topic: 'push.route_notice',
          aggregateType: 'staff',
          aggregateId: staff.id,
          dedupeKey: outboxDedupeKey('push.route_notice', staff.id, date),
          payload: pushPayload({
            staffId: staff.id,
            notice: buildRouteNotice(date, appointments),
            ttlSeconds: ROUTE_NOTICE_TTL_SECONDS,
            topic: routeNoticeTopic(date),
          }),
        }),
      );
      summary.queued++;
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
    failed: summaries.reduce((n, s) => n + s.failed, 0),
    interrupted: interrupted || summaries.some((s) => s.interrupted),
  };
}
