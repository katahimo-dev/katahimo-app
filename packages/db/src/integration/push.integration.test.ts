import { newId } from '@katahimo/core/domain';
import { FakeAppLogPort, FakeSchedulePort } from '@katahimo/core/test-utils';
import { runRouteNoticeJob, sendTestPush, subscribePush, unsubscribePush } from '@katahimo/core/usecases';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { pgErrorOf } from '../errors';
import { DrizzleTenantDirectory } from '../repositories/platform/tenants';
import { connect } from './testDb';

/** Web Push の購読(push_subscriptions)とお知らせの積み込みを実際の DB で確かめる。 */
const { app, owner, uow, createTenant, createStaff } = connect();
const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
const deps = { uow, appLog: new FakeAppLogPort(), pushPublicKey: 'test-vapid-public-key' };
const endpointOf = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}-${newId()}`;

const count = async (tenantId: string, query: ReturnType<typeof sql>) =>
  withTenant(app, tenantId, async (tx) =>
    Number(((await tx.execute(query)) as unknown as { n: string }[])[0]?.n ?? 0),
  );

async function tenantWithStaff(names: string[]) {
  const tenantId = await createTenant('push');
  const ids = await uow.run(tenantId, async (r) => {
    const created: string[] = [];
    for (const name of names) created.push(await createStaff(r, name));
    return created;
  });
  return { tenantId, actors: ids.map((staffId) => ({ tenantId, staffId, role: 'staff' as const })) };
}

describe('Web Push の購読(push_subscriptions)', () => {
  it('同じ endpoint は1行のまま、別のスタッフが登録したらそのスタッフに付け替える', async () => {
    const { tenantId, actors } = await tenantWithStaff(['山田 太郎', '佐藤 花子']);
    const [taro, hanako] = actors as [(typeof actors)[number], (typeof actors)[number]];
    const endpoint = endpointOf('shared');
    await subscribePush(deps, { ...taro, meta: { userAgent: 'Android' } }, { endpoint, ...keys });
    const first = await uow.run(tenantId, (r) => r.pushSubscriptions.findByEndpoint(endpoint));
    expect(
      await uow.run(tenantId, (r) => r.pushSubscriptions.recordRejection(first?.id ?? '', new Date())),
    ).toBe(1);

    // 鍵の違う登録では付け替えない(409)。同じ鍵(同じ端末のブラウザの購読)なら付け替える
    await expect(
      subscribePush(deps, hanako, { endpoint, p256dh: 'q'.repeat(87), auth: keys.auth }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await subscribePush(deps, hanako, { endpoint, ...keys });
    const after = await uow.run(tenantId, (r) => r.pushSubscriptions.findByEndpoint(endpoint));
    expect(after).toMatchObject({
      id: first?.id,
      staffId: hanako.staffId,
      p256dh: keys.p256dh,
      failureCount: 0,
      userAgent: null,
    });
    expect(await count(tenantId, sql`select count(*) as n from push_subscriptions`)).toBe(1);
    expect(await uow.run(tenantId, (r) => r.pushSubscriptions.listSubscribedStaffIds())).toEqual([
      hanako.staffId,
    ]);

    // 付け替えられた元のスタッフは消せない。本人は消せる
    await unsubscribePush(deps, taro, endpoint);
    expect(await count(tenantId, sql`select count(*) as n from push_subscriptions`)).toBe(1);
    await unsubscribePush(deps, hanako, endpoint);
    expect(await count(tenantId, sql`select count(*) as n from push_subscriptions`)).toBe(0);
  });

  it('別テナントの購読は見えず、同じ端末(endpoint)でもテナントごとに別の行', async () => {
    const a = await tenantWithStaff(['山田 太郎']);
    const b = await tenantWithStaff(['山田 太郎']);
    const endpoint = endpointOf('both');
    await subscribePush(deps, a.actors[0] as (typeof a.actors)[number], { endpoint, ...keys });
    expect(await uow.run(b.tenantId, (r) => r.pushSubscriptions.findByEndpoint(endpoint))).toBeNull();
    await subscribePush(deps, b.actors[0] as (typeof b.actors)[number], { endpoint, ...keys });
    const [inA, inB] = await Promise.all(
      [a.tenantId, b.tenantId].map((t) => uow.run(t, (r) => r.pushSubscriptions.findByEndpoint(endpoint))),
    );
    expect(inA?.staffId).toBe(a.actors[0]?.staffId);
    expect(inB?.staffId).toBe(b.actors[0]?.staffId);
    // テナントを設定しなければ所有者でも読めない(FORCE RLS)
    expect(
      Number(
        (
          (await owner.execute(sql`select count(*) as n from push_subscriptions`)) as unknown as {
            n: string;
          }[]
        )[0]?.n,
      ),
    ).toBe(0);
  });

  it('スタッフを消すと購読も消え、https 以外の endpoint は DB も拒否する', async () => {
    const { tenantId, actors } = await tenantWithStaff(['山田 太郎']);
    const [taro] = actors as [(typeof actors)[number]];
    await subscribePush(deps, taro, { endpoint: endpointOf('cascade'), ...keys });
    await withTenant(owner, tenantId, (tx) => tx.execute(sql`delete from staff where id = ${taro.staffId}`));
    expect(await count(tenantId, sql`select count(*) as n from push_subscriptions`)).toBe(0);

    const insert = uow.run(tenantId, async (r) => {
      const staffId = await createStaff(r);
      return r.pushSubscriptions.upsert({
        id: newId(),
        staffId,
        endpoint: 'http://example.com/x',
        userAgent: null,
        ...keys,
      });
    });
    await expect(insert).rejects.toSatisfy((e: unknown) => pgErrorOf(e)?.code === '23514');
  });
});

describe('購読の上限と退職', () => {
  it('1人の購読は新しい(updated_at の遅い)ものから keep 件だけ残し、退職で全て消せる', async () => {
    const { tenantId, actors } = await tenantWithStaff(['山田 太郎', '佐藤 花子']);
    const [taro, hanako] = actors as [(typeof actors)[number], (typeof actors)[number]];
    const endpoints = [endpointOf('a'), endpointOf('b'), endpointOf('c')];
    for (const endpoint of endpoints) {
      await uow.run(tenantId, (r) =>
        r.pushSubscriptions.upsert({
          id: newId(),
          staffId: taro.staffId,
          endpoint,
          userAgent: null,
          ...keys,
        }),
      );
    }
    await subscribePush(deps, hanako, { endpoint: endpointOf('h'), ...keys });
    // 別のトランザクションで最初の端末を使う(updated_at が新しくなる)
    const first = await uow.run(tenantId, (r) => r.pushSubscriptions.findByEndpoint(endpoints[0] ?? ''));
    await uow.run(tenantId, (r) => r.pushSubscriptions.recordSuccess(first?.id ?? '', new Date()));
    expect(await uow.run(tenantId, (r) => r.pushSubscriptions.trimForStaff(taro.staffId, 2))).toBe(1);
    const left = await uow.run(tenantId, (r) => r.pushSubscriptions.listForStaff(taro.staffId));
    expect(left.map((p) => p.endpoint).sort()).toEqual([endpoints[0], endpoints[2]].sort());

    expect(await uow.run(tenantId, (r) => r.pushSubscriptions.deleteAllForStaff(taro.staffId))).toBe(2);
    expect(await count(tenantId, sql`select count(*) as n from push_subscriptions`)).toBe(1);
  });
});

describe('お知らせの積み込み(outbox)', () => {
  it('夜間ジョブを流し直しても、端末 × スタッフ × 日付で1件だけ積む(積み済みと数える)。テスト通知は押すたびに積む', async () => {
    const { tenantId, actors } = await tenantWithStaff(['山田 太郎']);
    const [taro] = actors as [(typeof actors)[number]];
    await subscribePush(deps, taro, { endpoint: endpointOf('dedupe'), ...keys });
    const tenant = await new DrizzleTenantDirectory(owner).findById(tenantId);
    if (!tenant) throw new Error('テナントがありません');
    const schedule = new FakeSchedulePort();
    schedule.setAppointments('山田 太郎', '2026-09-27', [
      {
        eventType: 'CUSTOMER APPOINTMENT',
        customerName: '佐藤 花子',
        startTime: '10:00',
        endTime: '12:00',
        reservaUrl: '',
        moveUrl: '',
        moveMin: '',
        moveKm: '',
        attendanceUrl: '',
        attendanceMin: '',
        attendanceKm: '',
        leavingUrl: '',
        leavingMin: '',
        leavingKm: '',
        customerId: '',
        address: '',
      },
    ]);
    const jobDeps = {
      uow,
      appLog: new FakeAppLogPort(),
      schedule,
      tenants: {
        findBySlug: async () => tenant,
        findById: async () => tenant,
        listActive: async () => [tenant],
        listAll: async () => [tenant],
      },
      now: () => new Date('2026-09-26T10:00:00Z'),
    };
    expect(await runRouteNoticeJob(jobDeps)).toMatchObject({ queued: 1, alreadyQueued: 0, failed: 0 });
    expect(await runRouteNoticeJob(jobDeps)).toMatchObject({ queued: 0, alreadyQueued: 1, failed: 0 });
    expect(
      await count(tenantId, sql`select count(*) as n from outbox_messages where topic = 'push.route_notice'`),
    ).toBe(1);

    await sendTestPush(deps, taro);
    await sendTestPush(deps, taro);
    expect(
      await count(tenantId, sql`select count(*) as n from outbox_messages where topic = 'push.test'`),
    ).toBe(2);
  });
});
