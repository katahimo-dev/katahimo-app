import { STAFF_IMPORT_MAX_ROWS, STAFF_SHEET_COLUMNS } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import type { ImportCell } from '../reports/reportAiImport';
import {
  parseSheetDate,
  parseStaffSheet,
  planStaffImport,
  type StaffImportContext,
  type StaffSheetCurrent,
  staffToSheet,
} from './staffSheet';

const ADMIN_ID = '0190a000-0000-7000-8000-000000000001';
const STAFF_ID = '0190a000-0000-7000-8000-000000000002';
const OTHER_ADMIN_ID = '0190a000-0000-7000-8000-000000000003';

function current(overrides: Partial<StaffSheetCurrent> & { id: string; email: string }): StaffSheetCurrent {
  return {
    displayName: '名前',
    familyNameKana: null,
    givenNameKana: null,
    altEmail: null,
    phone: null,
    role: 'staff',
    retiredOn: null,
    homeAddress: null,
    travelMode: null,
    gender: null,
    scheduleCalendarId: null,
    ...overrides,
  };
}

const baseStaff: StaffSheetCurrent[] = [
  current({ id: ADMIN_ID, displayName: '管理 者', email: 'admin@example.com', role: 'admin' }),
  current({
    id: STAFF_ID,
    displayName: '佐藤 花子',
    familyNameKana: 'サトウ',
    givenNameKana: 'ハナコ',
    email: 'hanako@example.com',
    phone: '090-1111-2222',
    travelMode: 'bicycle',
    gender: 'female',
  }),
];

const context = (staff: StaffSheetCurrent[] = baseStaff): StaffImportContext => ({
  staff,
  actorStaffId: ADMIN_ID,
  calendarSettings: { sharedCalendars: [], allowedStaffCalendars: ['@cutest.biz'] },
});

const sheet = (rows: ImportCell[][], name = 'スタッフ') => [{ name, rows }];

/** 書き出した形(すべての列)のシート。 */
function exportedSheet(staff: StaffSheetCurrent[]) {
  const exported = staffToSheet(
    staff.map((s) => ({
      id: s.id,
      name: s.displayName,
      kana: [s.familyNameKana, s.givenNameKana].filter(Boolean).join(' ') || null,
      email: s.email,
      altEmail: s.altEmail,
      phone: s.phone,
      role: s.role,
      retiredOn: s.retiredOn,
      homeAddress: s.homeAddress,
      travelMode: s.travelMode,
      gender: s.gender,
      scheduleCalendarId: s.scheduleCalendarId,
    })),
  );
  return { exported, sheets: sheet([exported.header, ...exported.rows]) };
}

describe('スタッフの xlsx の書き出し', () => {
  it('見出しは STAFF_SHEET_COLUMNS の順、役割・移動手段・性別は日本語、空は null', () => {
    const { exported } = exportedSheet(baseStaff);
    expect(exported.name).toBe('スタッフ');
    expect(exported.header).toEqual(STAFF_SHEET_COLUMNS.map((c) => c.label));
    expect(exported.rows[1]).toEqual([
      STAFF_ID,
      '佐藤 花子',
      'サトウ ハナコ',
      'hanako@example.com',
      null,
      '090-1111-2222',
      'スタッフ',
      null,
      null,
      '自転車',
      '女性',
      null,
    ]);
  });

  it('書き出したものをそのまま読むと変更は無い', () => {
    const { sheets } = exportedSheet(baseStaff);
    const parsed = parseStaffSheet(sheets);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    const plan = planStaffImport(parsed, context());
    expect(plan.errors).toEqual([]);
    expect(plan.entries.map((e) => e.kind)).toEqual(['unchanged', 'unchanged']);
  });
});

describe('スタッフの xlsx の読み取り', () => {
  it('見出しは並び順を問わず、上の注記の行を飛ばし、知らない列は知らせる。空の行は読まない', () => {
    const parsed = parseStaffSheet(
      sheet([
        ['スタッフの一覧(注記)'],
        ['メール アドレス', '備考', '氏名', '役割'],
        ['New@Example.com', 'x', ' 山田 太郎 ', '管理者'],
        [null, '', null, null],
        ['b@example.com', null, '鈴木', 'coordinator'],
      ]),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([{ row: 2, message: '列「備考」は読みません' }]);
    expect(parsed.columns).toEqual(['name', 'email', 'role']);
    expect(parsed.rowCount).toBe(2);
    expect(parsed.rows).toEqual([
      { row: 3, id: null, values: { name: '山田 太郎', email: 'new@example.com', role: 'admin' } },
      { row: 5, id: null, values: { name: '鈴木', email: 'b@example.com', role: 'coordinator' } },
    ]);
  });

  it('シート「スタッフ」が無ければ先頭のシート。氏名・メールアドレスの見出しが無ければ誤り', () => {
    expect(
      parseStaffSheet([
        {
          name: 'Sheet1',
          rows: [
            ['氏名', 'メールアドレス'],
            ['A', 'a@example.com'],
          ],
        },
      ]).rows,
    ).toHaveLength(1);
    expect(parseStaffSheet(sheet([['氏名', '電話']])).errors).toEqual([
      { row: null, message: 'シート「スタッフ」に「氏名」「メールアドレス」の見出しの行が見つかりません' },
    ]);
    expect(parseStaffSheet([]).errors).toHaveLength(1);
  });

  it('セルを画面と同じ規則で確かめ、誤りは行番号つき', () => {
    const parsed = parseStaffSheet(
      sheet([
        [
          'ID',
          '氏名',
          'メールアドレス',
          'サブメール',
          '役割',
          '退職日',
          '移動手段',
          '性別',
          '予定カレンダーID',
        ],
        ['not-a-uuid', '', 'bad', 'x', '社長', '2026-02-30', '飛行機', '?', 'no-at-mark'],
      ]),
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors.map((e) => e.row)).toEqual(Array(9).fill(2));
    expect(parsed.errors.map((e) => e.message)).toEqual([
      expect.stringContaining('ID の形'),
      '氏名: 氏名を入力してください',
      'メールアドレス: メールアドレスの形式が正しくありません',
      'サブメール: メールアドレスの形式が正しくありません',
      expect.stringContaining('役割: 「スタッフ」「コーディネーター」「管理者」'),
      '退職日: 日付は「YYYY-MM-DD」の形で入力してください',
      expect.stringContaining('移動手段:'),
      expect.stringContaining('性別:'),
      'カレンダーIDは「…@…」の形で入力してください'.replace(/^/, '予定カレンダーID: '),
    ]);
  });

  it('電話が数のセルなら文字にして知らせる', () => {
    const parsed = parseStaffSheet(
      sheet([
        ['氏名', 'メールアドレス', '電話'],
        ['A', 'a@example.com', 9012345678],
      ]),
    );
    expect(parsed.rows[0]?.values.phone).toBe('9012345678');
    expect(parsed.warnings).toEqual([{ row: 2, message: expect.stringContaining('先頭の 0') }]);
  });

  it(`${STAFF_IMPORT_MAX_ROWS}行を超えると誤り`, () => {
    const rows: ImportCell[][] = [['氏名', 'メールアドレス']];
    for (let i = 0; i <= STAFF_IMPORT_MAX_ROWS; i++) rows.push([`S${i}`, `s${i}@example.com`]);
    const parsed = parseStaffSheet(sheet(rows));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([{ row: null, message: expect.stringContaining('多すぎます') }]);
  });

  it('退職日は日付のセル・シリアル値・YYYY-MM-DD・YYYY/MM/DD を読む', () => {
    expect(parseSheetDate(new Date(Date.UTC(2026, 8, 30)))).toBe('2026-09-30');
    expect(parseSheetDate(46295)).toBe('2026-09-30');
    expect(parseSheetDate('2026/9/3')).toBe('2026-09-03');
    expect(parseSheetDate('２０２６－０９－３０')).toBe('2026-09-30');
    expect(parseSheetDate('')).toBeNull();
    expect(parseSheetDate('9月30日')).toBeUndefined();
    expect(parseSheetDate('2026-13-01')).toBeUndefined();
  });
});

describe('今のスタッフとの突き合わせ', () => {
  it('ID があれば ID、無ければメールアドレスで突き合わせ、変わる列だけを数える。見出しの無い列は変えない', () => {
    const parsed = parseStaffSheet(
      sheet([
        ['ID', '氏名', 'メールアドレス', '電話', 'カナ'],
        [STAFF_ID, '佐藤 花子', 'hanako-new@example.com', '', 'ｻﾄｳ ﾊﾅｺ'],
        [null, '管理 者', 'ADMIN@example.com', null, null],
        [null, '新人', 'new@example.com', '080', 'シンジン'],
      ]),
    );
    const plan = planStaffImport(parsed, context());
    expect(plan.errors).toEqual([]);
    expect(plan.entries.map((e) => [e.row, e.kind, e.staffId, e.fields])).toEqual([
      [2, 'update', STAFF_ID, ['email', 'phone']],
      [3, 'unchanged', ADMIN_ID, []],
      [4, 'create', null, ['name', 'kana', 'email', 'phone']],
    ]);
    expect(plan.entries[0]?.next).toMatchObject({ phone: null, travelMode: 'bicycle', gender: 'female' });
    expect(plan.entries[2]?.next.role).toBe('staff');
  });

  it('知らない ID・同じスタッフの2行・ファイル内や他のスタッフとのメールの重なりは誤り', () => {
    const parsed = parseStaffSheet(
      sheet([
        ['ID', '氏名', 'メールアドレス', 'サブメール'],
        ['0190a000-0000-7000-8000-0000000000ff', 'X', 'x@example.com', null],
        [STAFF_ID, '佐藤 花子', 'hanako@example.com', null],
        [null, '佐藤 花子', 'hanako@example.com', null],
        [null, 'A', 'a@example.com', 'dup@example.com'],
        [null, 'B', 'dup@example.com', null],
        [null, 'C', 'c@example.com', 'c@example.com'],
        [null, 'D', 'd@example.com', 'admin@example.com'],
      ]),
    );
    const plan = planStaffImport(parsed, context());
    expect(plan.errors).toEqual([
      { row: 2, message: expect.stringContaining('この ID のスタッフはいません') },
      { row: 4, message: '3行目と同じスタッフの行です' },
      { row: 6, message: expect.stringContaining('(5行目と重なっています)') },
      { row: 7, message: expect.stringContaining('サブメール:') },
      {
        row: 8,
        message: 'サブメール: このサブメールは他のスタッフが使用しているか、メールアドレスと同じです',
      },
    ]);
  });

  it('自分自身の降格・退職日の設定、既存のスタッフの役割の空欄は誤り。新しいスタッフの役割の空欄は「スタッフ」', () => {
    const parsed = parseStaffSheet(
      sheet([
        ['ID', '氏名', 'メールアドレス', '役割', '退職日'],
        [ADMIN_ID, '管理 者', 'admin@example.com', 'スタッフ', '2026-10-01'],
        [STAFF_ID, '佐藤 花子', 'hanako@example.com', null, null],
        [null, '新人', 'new@example.com', null, null],
      ]),
    );
    const plan = planStaffImport(parsed, {
      ...context([...baseStaff, current({ id: OTHER_ADMIN_ID, email: 'admin2@example.com', role: 'admin' })]),
    });
    expect(plan.errors).toEqual([
      { row: 2, message: '自分自身の管理者権限は解除できません' },
      { row: 2, message: '自分自身に退職日は設定できません' },
      { row: 3, message: '役割: 役割を入力してください' },
    ]);
    expect(plan.entries.find((e) => e.row === 4)?.next.role).toBe('staff');
  });

  it('取込の後に退職日の決まっていない管理者が残らなければ誤り(last_admin)', () => {
    const staff = [...baseStaff, current({ id: OTHER_ADMIN_ID, email: 'admin2@example.com', role: 'admin' })];
    const demoteOther = (extra: ImportCell[][] = []) =>
      planStaffImport(
        parseStaffSheet(
          sheet([
            ['ID', '氏名', 'メールアドレス', '役割', '退職日'],
            [OTHER_ADMIN_ID, '名前', 'admin2@example.com', '管理者', '2026-12-31'],
            ...extra,
          ]),
        ),
        { ...context(staff), actorStaffId: ADMIN_ID },
      );
    // 自分(管理者)が残るので良い
    expect(demoteOther().errors).toEqual([]);
    // 自分が退職日の決まった管理者なら、もう1人を退職させると残らない
    const retiredActor = staff.map((s) => (s.id === ADMIN_ID ? { ...s, retiredOn: '2026-12-31' } : s));
    const plan = planStaffImport(
      parseStaffSheet(
        sheet([
          ['ID', '氏名', 'メールアドレス', '役割'],
          [OTHER_ADMIN_ID, '名前', 'admin2@example.com', 'スタッフ'],
        ]),
      ),
      context(retiredActor),
    );
    expect(plan.errors).toEqual([{ row: null, message: expect.stringContaining('管理者が1人もいなくなる') }]);
    // 同じファイルで新しい管理者を足せば良い
    expect(
      planStaffImport(
        parseStaffSheet(
          sheet([
            ['ID', '氏名', 'メールアドレス', '役割'],
            [OTHER_ADMIN_ID, '名前', 'admin2@example.com', 'スタッフ'],
            [null, '新管理者', 'boss@example.com', '管理者'],
          ]),
        ),
        context(retiredActor),
      ).errors,
    ).toEqual([]);
  });

  it('予定のカレンダーは変えるときだけ許可の一覧で確かめる', () => {
    const staff = baseStaff.map((s) =>
      s.id === STAFF_ID ? { ...s, scheduleCalendarId: 'old@gmail.com' } : s,
    );
    const rows = (calendar: string) =>
      parseStaffSheet(
        sheet([
          ['ID', '氏名', 'メールアドレス', '予定カレンダーID'],
          [STAFF_ID, '佐藤 花子', 'hanako@example.com', calendar],
        ]),
      );
    expect(planStaffImport(rows('old@gmail.com'), context(staff)).errors).toEqual([]);
    expect(planStaffImport(rows('x@gmail.com'), context(staff)).errors).toEqual([
      { row: 2, message: expect.stringContaining('このカレンダーは使えません') },
    ]);
    const ok = planStaffImport(rows('Hanako@Cutest.biz'), context(staff));
    expect(ok.errors).toEqual([]);
    expect(ok.entries[0]?.next.scheduleCalendarId).toBe('hanako@cutest.biz');
  });
});
