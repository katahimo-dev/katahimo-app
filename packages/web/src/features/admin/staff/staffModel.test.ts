import { describe, expect, it } from 'vitest';
import { adminStaff } from '../adminFixtures.test-helper';
import { filterStaff, staffFormOf, toCreateRequest, toUpdateRequest } from './staffModel';

describe('スタッフ一覧の絞り込み', () => {
  const list = [
    adminStaff(),
    adminStaff({
      id: '00000000-0000-4000-8000-00000000b002',
      name: '鈴木 一郎',
      kana: null,
      email: 'ichiro@x.jp',
    }),
    adminStaff({ id: '00000000-0000-4000-8000-00000000b003', name: '退職 者', isRetired: true }),
  ];

  it('氏名・カナ・メールの一部で探し(空白は無視)、退職者は表示するときだけ', () => {
    expect(filterStaff(list, '', false).map((s) => s.name)).toEqual(['佐藤 花子', '鈴木 一郎']);
    expect(filterStaff(list, '', true)).toHaveLength(3);
    expect(filterStaff(list, 'サトウハナコ', false).map((s) => s.name)).toEqual(['佐藤 花子']);
    expect(filterStaff(list, 'ICHIRO', false).map((s) => s.name)).toEqual(['鈴木 一郎']);
    expect(filterStaff(list, '鈴木 一', false)).toHaveLength(1);
  });
});

describe('スタッフの入力欄 → API', () => {
  it('登録は空欄を null にし、初期パスワードは入れたときだけ送る', () => {
    const values = { ...staffFormOf(adminStaff()), phone: ' ', travelMode: 'walk' as const };
    expect(toCreateRequest(values)).toMatchObject({ phone: null, travelMode: 'walk', gender: null });
    expect(toCreateRequest(values)).not.toHaveProperty('initialPassword');
    expect(toCreateRequest({ ...values, initialPassword: 'secret-pass' })).toMatchObject({
      initialPassword: 'secret-pass',
    });
  });

  it('更新は変えた項目だけを版と一緒に送り、何も変えていなければ null', () => {
    const staff = adminStaff({ phone: '090' });
    expect(toUpdateRequest(staff, staffFormOf(staff))).toBeNull();
    expect(
      toUpdateRequest(staff, {
        ...staffFormOf(staff),
        phone: '',
        retiredOn: '2026-09-30',
        homeAddress: '新住所',
      }),
    ).toEqual({ phone: null, retiredOn: '2026-09-30', homeAddress: '新住所', rowVersion: 3 });
  });
});
