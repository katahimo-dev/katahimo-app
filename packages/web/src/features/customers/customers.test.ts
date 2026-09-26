import type { CustomerDetailView } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { buildDetailRows, buildFamilyRows } from './customerDetailRows';
import { filterCustomers } from './customerFilter';
import { historyBadge, ratingStars, splitHistoryTimestamp } from './historyFormat';

const customers = [
  { id: 'a', name: '田中 さくら', city: '世田谷区' },
  { id: 'b', name: '佐々木 あおい', city: '杉並区' },
  { id: 'c', name: 'Smith Anna', city: '世田谷区' },
  { id: 'd', name: '伊藤 ひなた', city: null },
];

describe('filterCustomers', () => {
  it('絞り込みが無いときは最近のお客様を上に、それ以外は元の順', () => {
    expect(filterCustomers(customers, { search: '', city: '' }, ['d', 'b', 'x']).map((c) => c.id)).toEqual([
      'd',
      'b',
      'a',
      'c',
    ]);
  });

  it('名前は大文字小文字を区別しない部分一致、地区は完全一致。絞り込み中は並べ替えない', () => {
    expect(filterCustomers(customers, { search: 'anna', city: '' }, []).map((c) => c.id)).toEqual(['c']);
    expect(filterCustomers(customers, { search: '', city: '世田谷区' }, ['c']).map((c) => c.id)).toEqual([
      'a',
      'c',
    ]);
    expect(filterCustomers(customers, { search: 'さ', city: '世田谷区' }, []).map((c) => c.id)).toEqual([
      'a',
    ]);
    expect(filterCustomers(customers, { search: 'zzz', city: '' }, [])).toEqual([]);
  });

  it('元の配列は並べ替えない', () => {
    const copy = [...customers];
    filterCustomers(customers, { search: '', city: '' }, ['d']);
    expect(customers).toEqual(copy);
  });
});

const detail = (overrides: Partial<CustomerDetailView> = {}): CustomerDetailView => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  externalSource: 'reserva',
  externalId: 'C0001',
  name: '田中 さくら',
  familyNameKana: 'タナカ',
  givenNameKana: 'サクラ',
  email: 'sakura@example.com',
  phone: '090-1234-5678',
  addressDetail: '東京都世田谷区桜新町1-2-3',
  city: '世田谷区',
  parkingArea: 'あり',
  parkingDetail: null,
  emergencyContact: null,
  emergencyContactRelation: null,
  evacuationSite: null,
  memo: null,
  benefitMemberId: null,
  address2: '大阪府大阪市北区1-1',
  address2StartDate: '2026-04-01',
  address2EndDate: null,
  latLng: '35.6315,139.6446',
  memberType: null,
  memberStatus: null,
  paymentMethod: null,
  paymentStatus: null,
  gender: null,
  ageBracket: null,
  registeredAt: '2025-08-12T04:12:00.000Z',
  externalLastUpdatedAt: null,
  archivedAt: null,
  familyMembers: [],
  ...overrides,
});

describe('buildDetailRows', () => {
  it('GAS版と同じ列名・順番で、空の列も出す', () => {
    const rows = buildDetailRows(detail());
    expect(rows.slice(0, 6).map((r) => [r.key, r.value])).toEqual([
      ['姓', '田中'],
      ['名', 'さくら'],
      ['姓（カナ）※必須項目', 'タナカ'],
      ['名（カナ）※必須項目', 'サクラ'],
      ['メールアドレス', 'sakura@example.com'],
      ['電話番号※必須項目', '090-1234-5678'],
    ]);
    expect(rows.find((r) => r.key === '登録日時')?.value).toBe('2025/08/12 13:12');
    expect(rows.find((r) => r.key === '住所2[適用開始日YYYY/MM/DD]')?.value).toBe('2026/04/01');
    expect(rows.find((r) => r.key === '顧客メモ')).toEqual({ key: '顧客メモ', value: '', action: null });
    expect(rows.some((r) => r.key.includes('顧客ID') || r.key.includes('パスワード'))).toBe(false);
  });

  it('住所は地図(緯度経度があればその場所)、メール・電話はそれぞれのリンク。住所2には付けない', () => {
    const rows = buildDetailRows(detail());
    const actionOf = (key: string) => rows.find((r) => r.key === key)?.action;
    expect(actionOf('住所')).toEqual({
      kind: 'map',
      href: 'https://www.google.com/maps/search/?api=1&query=35.6315,139.6446',
    });
    expect(actionOf('メールアドレス')).toEqual({ kind: 'mail', href: 'mailto:sakura@example.com' });
    expect(actionOf('電話番号※必須項目')).toEqual({ kind: 'tel', href: 'tel:090-1234-5678' });
    expect(actionOf('住所2')).toBeNull();

    const noLatLng = buildDetailRows(detail({ latLng: null, email: null }));
    expect(noLatLng.find((r) => r.key === '住所')?.action?.href).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('東京都世田谷区桜新町1-2-3')}`,
    );
    expect(noLatLng.find((r) => r.key === 'メールアドレス')?.action).toBeNull();
  });

  it('緯度・経度の行は取込元の表記のまま出し、地図はその場所を開く(読めない表記は住所で検索)', () => {
    const rows = buildDetailRows(detail({ latLng: '35.6810, 139.7670' }));
    expect(rows.find((r) => r.key === '緯度・経度')?.value).toBe('35.6810, 139.7670');
    expect(rows.find((r) => r.key === '住所')?.action?.href).toContain('35.681');
    const unreadable = buildDetailRows(detail({ latLng: '35.68,' }));
    expect(unreadable.find((r) => r.key === '緯度・経度')?.value).toBe('35.68,');
    expect(unreadable.find((r) => r.key === '住所')?.action?.href).toContain('maps/search/?api=1&query=%E6');
  });
});

describe('buildFamilyRows', () => {
  it('アレルギーが無ければ「なし」。生年月日は / 区切り', () => {
    expect(
      buildFamilyRows([
        { id: '1', name: '田中 ゆい', dob: '2023-04-12', info: '絵本が好き', allergy: '卵' },
        { id: '2', name: '田中 そうた', dob: null, info: null, allergy: null },
      ]),
    ).toEqual([
      { id: '1', name: '田中 ゆい', dob: '2023/04/12', allergyLabel: 'アレルギー: 卵', info: '絵本が好き' },
      { id: '2', name: '田中 そうた', dob: '', allergyLabel: 'アレルギー: なし', info: '' },
    ]);
  });
});

describe('historyFormat', () => {
  it('日報は青、事故報告は赤、ヒヤリハットは橙', () => {
    expect(historyBadge({ type: 'daily' })).toEqual({ title: '今日の日報', colorClass: 'bg-blue-500' });
    expect(historyBadge({ type: 'accident', subtype: '事故報告' })).toEqual({
      title: '事故報告',
      colorClass: 'bg-red-500',
    });
    expect(historyBadge({ type: 'accident', subtype: 'ヒヤリハット' }).colorClass).toBe('bg-orange-400');
    expect(historyBadge({ type: 'accident' }).title).toBe('事故報告');
  });

  it('評価の星と日時の分割', () => {
    expect(ratingStars(2)).toBe('★★☆☆☆');
    expect(ratingStars(0)).toBeNull();
    expect(ratingStars(null)).toBeNull();
    expect(ratingStars(9)).toBe('★★★★★');
    expect(splitHistoryTimestamp('2026/09/24 11:40')).toEqual({ date: '2026/09/24', time: '11:40' });
    expect(splitHistoryTimestamp('2026/09/24')).toEqual({ date: '2026/09/24', time: '' });
  });
});
