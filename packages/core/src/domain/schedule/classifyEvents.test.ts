import { describe, expect, it } from 'vitest';
import { calendarEvent, customers, jst, reservaDescription, source } from './__fixtures__/builders';
import { classifyCalendarEvents } from './classifyEvents';

describe('classifyCalendarEvents: [予約確定](RESERVA予約)', () => {
  it('説明欄の「施設：<スタッフ名>[」を担当者にし、タイトルの氏名で顧客DBと突合する', () => {
    const [result] = classifyCalendarEvents(
      [
        source('info@cutest.biz', [
          calendarEvent({ title: '[予約確定]山田 花子', description: reservaDescription('佐藤 美咲') }),
        ]),
      ],
      customers,
    );
    expect(result).toEqual({
      type: 'CUSTOMER APPOINTMENT',
      start: jst('2026-09-25 10:00'),
      end: jst('2026-09-25 12:00'),
      name: '山田 花子',
      customerId: 'C0001',
      place: customers[0]?.place,
      reservaUrl: 'https://reserva.be/cutest/reservation/detail?id=1234567&tab=info',
      assigneeNames: ['佐藤 美咲'],
    });
  });

  it('氏名の空白(全角/半角/有無)の違いは無視して突合し、表示名は顧客DBの氏名になる', () => {
    const result = classifyCalendarEvents(
      [
        source('佐藤 美咲', [
          calendarEvent({ title: '[予約確定] 山田花子 ' }),
          calendarEvent({ title: '[予約確定]田中 美和' }),
        ]),
      ],
      customers,
    );
    expect(result.map((a) => [a.name, a.customerId])).toEqual([
      ['山田 花子', 'C0001'],
      ['田中　美和', ''],
    ]);
  });

  it('説明欄に施設が無ければカレンダーの持ち主が担当。「施設：[」のように空なら担当者は空文字', () => {
    const result = classifyCalendarEvents(
      [
        source('佐藤 美咲', [
          calendarEvent({ title: '[予約確定]山田 花子', description: '予約番号：1' }),
          calendarEvent({ title: '[予約確定]山田 花子', description: '施設：[訪問保育]' }),
        ]),
      ],
      customers,
    );
    expect(result.map((a) => a.assigneeNames)).toEqual([['佐藤 美咲'], ['']]);
  });

  it('顧客DBに居ない氏名は場所なし・顧客IDなしの予定になる', () => {
    const [result] = classifyCalendarEvents(
      [source('佐藤 美咲', [calendarEvent({ title: '[予約確定]未登録 太郎', location: '東京都港区' })])],
      customers,
    );
    expect(result).toMatchObject({
      name: '未登録 太郎',
      customerId: '',
      place: { address: '', latLng: null },
    });
  });

  it('説明欄に「オンライン」があれば場所を持たない(顧客DB上の住所は他の予定に影響しない)', () => {
    const result = classifyCalendarEvents(
      [
        source('佐藤 美咲', [
          calendarEvent({
            title: '[予約確定]山田 花子',
            description: reservaDescription('佐藤 美咲', { online: true }),
            at: ['2026-09-25 09:00', '2026-09-25 10:00'],
          }),
          calendarEvent({ title: '[予約確定]山田 花子', at: ['2026-09-25 13:00', '2026-09-25 15:00'] }),
        ]),
      ],
      customers,
    );
    expect(result[0]?.place).toEqual({ address: '', latLng: null });
    expect(result[0]?.customerId).toBe('C0001');
    expect(result[1]?.place).toEqual(customers[0]?.place);
  });

  it('予約詳細URLが無ければ空文字', () => {
    const [result] = classifyCalendarEvents(
      [
        source('佐藤 美咲', [
          calendarEvent({ title: '[予約確定]山田 花子', description: '施設：佐藤 美咲[' }),
        ]),
      ],
      customers,
    );
    expect(result?.reservaUrl).toBe('');
  });

  it('同名の顧客が複数いれば先に登録された方と突合する', () => {
    const [result] = classifyCalendarEvents(
      [source('佐藤 美咲', [calendarEvent({ title: '[予約確定]山田 花子' })])],
      [...customers, { customerId: 'C9999', name: '山田花子', place: { address: '別住所', latLng: null } }],
    );
    expect(result?.customerId).toBe('C0001');
  });
});

describe('classifyCalendarEvents: スタッフが入れる予定', () => {
  it('[新規]は持ち主の顧客訪問として、場所欄の住所を使う(顧客DBとは突合しない)', () => {
    const [result] = classifyCalendarEvents(
      [
        source('高橋 由美', [
          calendarEvent({ title: '[新規]山田 花子 体験', location: '東京都杉並区荻窪1-1-1' }),
        ]),
      ],
      customers,
    );
    expect(result).toMatchObject({
      type: 'CUSTOMER APPOINTMENT',
      name: '山田 花子 体験',
      customerId: '',
      place: { address: '東京都杉並区荻窪1-1-1', latLng: null },
      assigneeNames: ['高橋 由美'],
    });
  });

  it('[イベント]はゲスト全員が担当。ゲストがいなければ持ち主', () => {
    const result = classifyCalendarEvents(
      [
        source('高橋 由美', [
          calendarEvent({ title: '[イベント]全体研修', guestNames: ['佐藤 美咲', 'tanaka@cutest.biz'] }),
          calendarEvent({ title: '[イベント]個人研修' }),
        ]),
      ],
      customers,
    );
    expect(result.map((a) => [a.type, a.assigneeNames])).toEqual([
      ['EVENT', ['佐藤 美咲', 'tanaka@cutest.biz']],
      ['EVENT', ['高橋 由美']],
    ]);
  });

  it('[事務]は持ち主の事務作業', () => {
    const [result] = classifyCalendarEvents(
      [source('高橋 由美', [calendarEvent({ title: '[事務]請求書作成' })])],
      customers,
    );
    expect(result).toMatchObject({ type: 'OFFICE WORK', name: '請求書作成', assigneeNames: ['高橋 由美'] });
  });

  it('タグの無い予定は対象外', () => {
    expect(
      classifyCalendarEvents([source('高橋 由美', [calendarEvent({ title: '歯医者' })])], customers),
    ).toEqual([]);
  });
});

describe('classifyCalendarEvents: 複数カレンダー', () => {
  it('同じ予定(同じiCalUID)が複数カレンダーにあれば、先に読んだカレンダーの持ち主になる', () => {
    const shared = calendarEvent({ title: '[事務]打合せ', dedupeKey: 'shared@google.com' });
    const result = classifyCalendarEvents(
      [source('佐藤 美咲', [shared]), source('高橋 由美', [{ ...shared }])],
      customers,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.assigneeNames).toEqual(['佐藤 美咲']);
  });

  it('持ち主が「いいえ」と回答したカレンダーの分は読まず、他のカレンダーに同じ予定があればそちらを使う', () => {
    const shared = calendarEvent({ title: '[事務]打合せ', dedupeKey: 'shared@google.com' });
    const result = classifyCalendarEvents(
      [source('佐藤 美咲', [{ ...shared, declinedByOwner: true }]), source('高橋 由美', [shared])],
      customers,
    );
    expect(result.map((a) => a.assigneeNames)).toEqual([['高橋 由美']]);
  });

  it('終日予定もタグがあれば対象(時刻はJST 0:00〜翌0:00)', () => {
    const [result] = classifyCalendarEvents(
      [
        source('高橋 由美', [
          calendarEvent({
            title: '[事務]棚卸し',
            allDay: true,
            start: jst('2026-09-25 00:00'),
            end: jst('2026-09-26 00:00'),
          }),
        ]),
      ],
      customers,
    );
    expect(result?.end).toEqual(jst('2026-09-26 00:00'));
  });
});
