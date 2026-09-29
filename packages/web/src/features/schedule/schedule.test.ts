import type { ScheduleAppointmentWithRouteView, ScheduleWithRouteResponse } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../lib/memoryStorage.test-helper';
import { eventTypeBorderClass, eventTypeIcon, formatEventTypeLabel, isCustomerEventType } from './eventTypes';
import { findCustomerByScheduleName } from './findCustomerByScheduleName';
import {
  pruneCachedRoutes,
  ROUTE_CACHE_TTL_MS,
  readCachedRoute,
  routeCacheKey,
  writeCachedRoute,
} from './routeCache';
import { formatRouteFetchedAt, routeMetaText, scheduleDateFor } from './scheduleDate';
import { itemsFromPlainSchedule, itemsFromRouteSchedule, toRouteLeg } from './scheduleItems';

describe('scheduleDateFor', () => {
  it('「9月3日（水）今日」「9月4日（木）明日」の形にする', () => {
    const now = new Date('2025-09-03T10:00:00+09:00');
    expect(scheduleDateFor(0, now)).toEqual({ dateStr: '2025-09-03', label: '9月3日（水）今日' });
    expect(scheduleDateFor(1, now)).toEqual({ dateStr: '2025-09-04', label: '9月4日（木）明日' });
  });

  it('日付はJSTで数える(UTCではまだ前日の朝0時台でも、JSTの日付になる)', () => {
    const now = new Date('2026-09-24T15:30:00Z'); // JSTでは 9/25 0:30
    expect(scheduleDateFor(0, now).dateStr).toBe('2026-09-25');
  });

  it('月末・年末をまたぐ', () => {
    expect(scheduleDateFor(1, new Date('2026-12-31T12:00:00+09:00'))).toEqual({
      dateStr: '2027-01-01',
      label: '1月1日（金）明日',
    });
  });

  it('「9月25日（金） 10:05 時点」はJSTの日付・時刻(今日の分でも日付を出す)', () => {
    expect(formatRouteFetchedAt(new Date('2026-09-25T01:05:00Z').getTime())).toBe('9月25日（金） 10:05 時点');
    // JSTでは次の日になる時刻
    expect(formatRouteFetchedAt(new Date('2026-09-25T15:30:00Z').getTime())).toBe('9月26日（土） 00:30 時点');
  });

  it('一覧の下の時点の表示に、最新を確かめている間・確かめられなかったことを添える', () => {
    const ts = new Date('2026-09-25T01:05:00Z').getTime();
    expect(routeMetaText(ts, 'fresh')).toBe('9月25日（金） 10:05 時点');
    expect(routeMetaText(ts, 'revalidating')).toBe('9月25日（金） 10:05 時点（最新を確認中…）');
    expect(routeMetaText(ts, 'stale')).toBe('9月25日（金） 10:05 時点（最新を読み込めませんでした）');
    expect(routeMetaText(null, null)).toBe('');
  });
});

describe('eventTypes', () => {
  it('種類の名前・アイコン・枠線(GAS版と同じ)', () => {
    expect(formatEventTypeLabel('CUSTOMER APPOINTMENT')).toBe('お客様の訪問');
    expect(formatEventTypeLabel('OFFICE WORK')).toBe('事務作業');
    expect(formatEventTypeLabel('EVENT')).toBe('イベント');
    expect(formatEventTypeLabel('OTHER')).toBe('OTHER');
    expect(formatEventTypeLabel('')).toBe('');
    expect(eventTypeIcon('OFFICE WORK')).toBe('📝');
    expect(eventTypeIcon('???')).toBe('🕒');
    expect(eventTypeBorderClass('EVENT')).toBe('border-l-4 border-l-teal-400');
    expect(eventTypeBorderClass('???')).toBe('');
    expect(isCustomerEventType('CUSTOMER APPOINTMENT')).toBe(true);
    expect(isCustomerEventType('EVENT')).toBe(false);
  });
});

const DIR =
  'https://www.google.com/maps/dir/?api=1&origin=35.1,139.1&destination=35.6315,139.6446&travelmode=driving';

describe('toRouteLeg', () => {
  it('「30分（12km）」の形。道順と「今いる場所から」のURLを作る', () => {
    expect(toRouteLeg('🏠 家から', 30, '12.00', DIR)).toEqual({
      label: '🏠 家から',
      detail: '30分（12.00km）',
      directionsUrl: DIR,
      currentLocationUrl:
        'https://www.google.com/maps/dir/?api=1&destination=35.6315,139.6446&travelmode=driving',
    });
  });

  it('分だけ・距離だけでも出す。どちらも無い(0・空)区間は出さない', () => {
    expect(toRouteLeg('🚗 次へ', 12, '', '')?.detail).toBe('12分');
    expect(toRouteLeg('🚗 次へ', '', 3.4, '')?.detail).toBe('（3.4km）');
    expect(toRouteLeg('🚗 次へ', 0, '', DIR)).toBeNull();
    expect(toRouteLeg('🚗 次へ', '', '', '')).toBeNull();
  });

  it('目的地の座標が読めないURLでは「今いる場所から」を作らない', () => {
    expect(toRouteLeg('🚗 次へ', 5, 1, 'https://example.com/x')?.currentLocationUrl).toBe('');
  });
});

const routeApp = (
  overrides: Partial<ScheduleAppointmentWithRouteView>,
): ScheduleAppointmentWithRouteView => ({
  eventType: 'CUSTOMER APPOINTMENT',
  customerName: '田中 さくら',
  startTime: '09:30',
  endTime: '11:30',
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
  address: '東京都',
  ...overrides,
});

describe('itemsFromRouteSchedule', () => {
  it('出勤の区間があれば「🏠 家から」、無ければ「🚗 次へ」。退勤は「🏠 家へ」', () => {
    const [first, second] = itemsFromRouteSchedule([
      routeApp({ attendanceMin: 18, attendanceKm: 6.2, attendanceUrl: DIR, moveMin: 99 }),
      routeApp({ moveMin: 25, moveKm: 8.4, leavingMin: 35, leavingKm: '12.80' }),
    ]);
    expect(first?.legBefore?.label).toBe('🏠 家から');
    expect(first?.legBefore?.detail).toBe('18分（6.2km）');
    expect(first?.legAfter).toBeNull();
    expect(second?.legBefore?.label).toBe('🚗 次へ');
    expect(second?.legAfter).toMatchObject({ label: '🏠 家へ', detail: '35分（12.80km）' });
  });

  it('出勤のURLだけある区間は、「家から」を選ぶが分も距離も無いので出さない(GAS版と同じ)', () => {
    const [item] = itemsFromRouteSchedule([routeApp({ attendanceUrl: DIR, moveMin: 10 })]);
    expect(item?.legBefore).toBeNull();
  });

  it('ルートなしの予定は title/start/end を使い、移動は無し', () => {
    expect(
      itemsFromPlainSchedule([
        { title: '研修会', eventType: 'EVENT', start: '13:00', end: '14:00', address: '' },
      ]),
    ).toEqual([
      {
        eventType: 'EVENT',
        name: '研修会',
        start: '13:00',
        end: '14:00',
        address: '',
        legBefore: null,
        legAfter: null,
      },
    ]);
  });
});

describe('routeCache', () => {
  const res: ScheduleWithRouteResponse = { success: true, appointments: [] };

  it('24時間以内は使い、過ぎたら使わない', () => {
    const storage = createMemoryStorage();
    const t0 = 1_000_000;
    writeCachedRoute('staff-1', '2026-09-25', res, t0, storage);
    expect(readCachedRoute('staff-1', '2026-09-25', t0 + ROUTE_CACHE_TTL_MS, storage)).toEqual({
      res,
      ts: t0,
    });
    expect(readCachedRoute('staff-1', '2026-09-25', t0 + ROUTE_CACHE_TTL_MS + 1, storage)).toBeNull();
  });

  it('スタッフ・日付ごとに分ける', () => {
    const storage = createMemoryStorage();
    writeCachedRoute('staff-1', '2026-09-25', res, 0, storage);
    expect(readCachedRoute('staff-2', '2026-09-25', 0, storage)).toBeNull();
    expect(readCachedRoute('staff-1', '2026-09-26', 0, storage)).toBeNull();
    expect(Object.keys(storage.snapshot())).toEqual([routeCacheKey('staff-1', '2026-09-25')]);
    expect(routeCacheKey('staff-1', '2026-09-25')).toBe('katahimo_schedule_route_v1_staff-1_2026-09-25');
  });

  it('壊れた値は無視する', () => {
    const storage = createMemoryStorage({ [routeCacheKey('s', 'd')]: '{broken' });
    expect(readCachedRoute('s', 'd', 0, storage)).toBeNull();
    const storage2 = createMemoryStorage({ [routeCacheKey('s', 'd')]: JSON.stringify({ res }) });
    expect(readCachedRoute('s', 'd', 0, storage2)).toBeNull();
    // 契約と形が違う値も使わない
    const storage3 = createMemoryStorage({
      [routeCacheKey('s', 'd')]: JSON.stringify({ res: { success: 'yes' }, ts: 0 }),
    });
    expect(readCachedRoute('s', 'd', 0, storage3)).toBeNull();
  });

  it('書くときに期限切れ・壊れたルートのキャッシュを消す(ほかのキーには触らない)', () => {
    const storage = createMemoryStorage({
      [routeCacheKey('s', '2026-09-20')]: JSON.stringify({ res, ts: 0 }),
      [routeCacheKey('s', '2026-09-21')]: '{broken',
      app_text_size: 'large',
    });
    const now = ROUTE_CACHE_TTL_MS + 1;
    writeCachedRoute('s', '2026-09-25', res, now, storage);
    expect(Object.keys(storage.snapshot()).sort()).toEqual(
      ['app_text_size', routeCacheKey('s', '2026-09-25')].sort(),
    );
    pruneCachedRoutes(now, storage);
    expect(readCachedRoute('s', '2026-09-25', now, storage)?.ts).toBe(now);
  });
});

describe('findCustomerByScheduleName', () => {
  const customers = [
    { id: '1', name: '田中 さくら' },
    { id: '2', name: '佐々木 あおい' },
    { id: '3', name: '高橋 みお' },
    { id: '4', name: '高橋　みお' },
  ];

  it('空白をすべて取りのぞいて完全一致で探す', () => {
    expect(findCustomerByScheduleName(customers, '田中さくら')?.id).toBe('1');
    expect(findCustomerByScheduleName(customers, ' 佐々木　あおい ')?.id).toBe('2');
  });

  it('部分一致では開かない・1件に決まらなければ null・空なら null', () => {
    expect(findCustomerByScheduleName(customers, '田中')).toBeNull();
    expect(findCustomerByScheduleName(customers, '高橋 みお')).toBeNull();
    expect(findCustomerByScheduleName(customers, '  ')).toBeNull();
  });
});
