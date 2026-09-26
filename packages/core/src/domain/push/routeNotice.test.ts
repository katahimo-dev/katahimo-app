import { pushNoticeSchema } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import type { ScheduleAppointmentLight } from '../../ports/schedule';
import {
  buildRouteNotice,
  buildTestNotice,
  formatNoticeDate,
  MAX_PUSH_TTL_SECONDS,
  pushTtlSeconds,
  ROUTE_NOTICE_MAX_LINES,
  routeNoticeExpiresAt,
  routeNoticeLine,
  routeNoticeTopic,
  selectRouteNoticeTargets,
  tomorrowInTimeZone,
} from './routeNotice';

const TOMORROW = { tomorrow: true };

const visit = (title: string, start = '10:00', end = '12:00'): ScheduleAppointmentLight => ({
  title,
  eventType: 'CUSTOMER APPOINTMENT',
  start,
  end,
  address: '東京都渋谷区1-2-3',
});

describe('翌日の予定のお知らせの文面', () => {
  it('タイトルは「明日の予定 9/27(日) 3件」、本文は時刻と「様」付きの名前、URL は予定タブの翌日', () => {
    const notice = buildRouteNotice(
      '2026-09-27',
      [
        visit('山田 花子', '09:00', '11:00'),
        { ...visit('事務作業', '13:00', '14:00'), eventType: 'OFFICE WORK' },
        visit('佐藤 一郎', '15:30', '18:00'),
      ],
      TOMORROW,
    );
    expect(notice).toEqual({
      title: '明日の予定 9/27(日) 3件',
      body: '09:00〜11:00 山田 花子様\n13:00〜14:00 事務作業\n15:30〜18:00 佐藤 一郎様',
      url: '/?schedule=2026-09-27',
      tag: 'route-notice-2026-09-27',
    });
    expect(pushNoticeSchema.safeParse(notice).success).toBe(true);
  });

  it('日付を指定して流し直した(明日でない)日は「9/27(日)の予定 N件」', () => {
    expect(buildRouteNotice('2026-09-27', [visit('山田 花子')], { tomorrow: false }).title).toBe(
      '9/27(日)の予定 1件',
    );
  });

  it('期限: 「明日の予定」はその日の0時(テナントの時刻帯)まで、日付のタイトルはその日の終わりまで', () => {
    expect(routeNoticeExpiresAt('2026-09-27', 'Asia/Tokyo', true).toISOString()).toBe(
      '2026-09-26T15:00:00.000Z',
    );
    expect(routeNoticeExpiresAt('2026-09-27', 'Asia/Tokyo', false).toISOString()).toBe(
      '2026-09-27T15:00:00.000Z',
    );
    expect(routeNoticeExpiresAt('2026-09-27', 'UTC', true).toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('TTL は期限までの残り(0以上・1日まで)', () => {
    const expiresAt = new Date('2026-09-26T15:00:00Z');
    expect(pushTtlSeconds(expiresAt, new Date('2026-09-26T10:00:00Z'))).toBe(5 * 60 * 60);
    expect(pushTtlSeconds(expiresAt, new Date('2026-09-26T15:00:00Z'))).toBe(0);
    expect(pushTtlSeconds(expiresAt, new Date('2026-09-27T00:00:00Z'))).toBe(0);
    expect(pushTtlSeconds(expiresAt, new Date('2026-09-20T00:00:00Z'))).toBe(MAX_PUSH_TTL_SECONDS);
  });

  it('住所は本文に入れない', () => {
    expect(buildRouteNotice('2026-09-27', [visit('山田 花子')], TOMORROW).body).not.toContain('渋谷区');
  });

  it(`${ROUTE_NOTICE_MAX_LINES}件を超える分は最後の行を「ほか N件」にまとめる`, () => {
    const appointments = Array.from({ length: 8 }, (_, i) => visit(`顧客${i + 1}`));
    const lines = buildRouteNotice('2026-09-27', appointments, TOMORROW).body.split('\n');
    expect(lines).toHaveLength(ROUTE_NOTICE_MAX_LINES);
    expect(lines.at(-1)).toBe('ほか4件');
    expect(lines[0]).toBe('10:00〜12:00 顧客1様');
    // ちょうど上限なら全て並べる
    const exact = buildRouteNotice(
      '2026-09-27',
      appointments.slice(0, ROUTE_NOTICE_MAX_LINES),
      TOMORROW,
    ).body;
    expect(exact.split('\n').at(-1)).toBe(`10:00〜12:00 顧客${ROUTE_NOTICE_MAX_LINES}様`);
  });

  it('長い名前は16文字で「…」にする(サロゲートペアを割らない)', () => {
    expect(routeNoticeLine(visit('あいうえおかきくけこさしすせそたち'))).toBe(
      '10:00〜12:00 あいうえおかきくけこさしすせそ…様',
    );
    expect(routeNoticeLine(visit('𠮷'.repeat(20)))).toBe(`10:00〜12:00 ${'𠮷'.repeat(15)}…様`);
    expect(routeNoticeLine(visit('あいうえおかきくけこさしすせそた'))).toBe(
      '10:00〜12:00 あいうえおかきくけこさしすせそた様',
    );
  });

  it('名前の無い予定には「様」を付けない', () => {
    expect(routeNoticeLine(visit(''))).toBe('10:00〜12:00');
  });

  it('日付と曜日・topic', () => {
    expect(formatNoticeDate('2026-01-04')).toBe('1/4(日)');
    expect(formatNoticeDate('2026-12-31')).toBe('12/31(木)');
    expect(routeNoticeTopic('2026-09-27')).toBe('route-20260927');
    expect(pushNoticeSchema.safeParse(buildTestNotice()).success).toBe(true);
  });
});

describe('お知らせの日付(テナントのタイムゾーンの明日)', () => {
  it('JST の 0 時をまたぐ境目', () => {
    // 2026-09-26 23:59 JST → 明日は 9/27
    expect(tomorrowInTimeZone(new Date('2026-09-26T14:59:00Z'), 'Asia/Tokyo')).toBe('2026-09-27');
    // 2026-09-27 00:00 JST → 明日は 9/28
    expect(tomorrowInTimeZone(new Date('2026-09-26T15:00:00Z'), 'Asia/Tokyo')).toBe('2026-09-28');
  });

  it('19:00 JST の実行(UTC では前日の10:00)', () => {
    expect(tomorrowInTimeZone(new Date('2026-09-26T10:00:00Z'), 'Asia/Tokyo')).toBe('2026-09-27');
    // 同じ時刻でも UTC のテナントでは暦が違う
    expect(tomorrowInTimeZone(new Date('2026-09-26T23:30:00Z'), 'UTC')).toBe('2026-09-27');
    expect(tomorrowInTimeZone(new Date('2026-09-26T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-09-28');
  });

  it('月末・年末', () => {
    expect(tomorrowInTimeZone(new Date('2026-12-31T10:00:00Z'), 'Asia/Tokyo')).toBe('2027-01-01');
    expect(tomorrowInTimeZone(new Date('2028-02-28T10:00:00Z'), 'Asia/Tokyo')).toBe('2028-02-29');
  });
});

describe('お知らせを送るスタッフの選び方', () => {
  it('在籍していて購読を持つスタッフだけ(並びは在籍の一覧の順)', () => {
    const active = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(selectRouteNoticeTargets(active, ['c', 'a', 'retired'])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(selectRouteNoticeTargets(active, [])).toEqual([]);
  });
});
