import { describe, expect, it } from 'vitest';
import {
  hashString,
  planVisitsForDate,
  recentBusinessDates,
  toJstDateIso,
  visitCountForDate,
} from './visitPlan';

/** 全20世帯を候補にする */
const ALL_20 = Array.from({ length: 20 }, (_, i) => i);

describe('visitCountForDate', () => {
  it('平日は3件、土曜は2件、日曜は1件', () => {
    expect(visitCountForDate('2026-09-28')).toBe(3); // 月曜
    expect(visitCountForDate('2026-09-26')).toBe(2); // 土曜
    expect(visitCountForDate('2026-09-27')).toBe(1); // 日曜
  });
});

describe('planVisitsForDate', () => {
  it('同じ日付・スタッフなら常に同じ結果になる(決定論的)', () => {
    const a = planVisitsForDate('2026-09-28', '鈴木 一郎', ALL_20);
    const b = planVisitsForDate('2026-09-28', '鈴木 一郎', ALL_20);
    expect(a).toEqual(b);
  });

  it('同じ日に同じ世帯を二重に入れない', () => {
    const visits = planVisitsForDate('2026-09-28', '鈴木 一郎', ALL_20);
    const indexes = visits.map((v) => v.figureIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it('スタッフが違えば訪問先が変わりうる', () => {
    const a = planVisitsForDate('2026-09-28', '鈴木 一郎', ALL_20);
    const b = planVisitsForDate('2026-09-28', '佐藤 美咲', ALL_20);
    expect(a).not.toEqual(b);
  });

  it('件数が曜日どおり(平日3件)で、時間帯が重ならない', () => {
    const visits = planVisitsForDate('2026-09-28', '鈴木 一郎', ALL_20);
    expect(visits).toHaveLength(3);
    for (let i = 0; i < visits.length - 1; i++) {
      const current = visits[i];
      const next = visits[i + 1];
      expect(current && next && current.end <= next.start).toBe(true);
    }
  });

  it('世帯数が0なら空', () => {
    expect(planVisitsForDate('2026-09-28', '鈴木 一郎', [])).toEqual([]);
  });
});

describe('recentBusinessDates', () => {
  it('today 基準で指定日数ぶんを古い順に返す(当日は含まない)', () => {
    const today = new Date('2026-09-28T03:00:00Z'); // JST 2026-09-28 12:00
    const dates = recentBusinessDates(today, 5);
    expect(dates).toEqual(['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
  });
});

describe('toJstDateIso', () => {
  it('UTCの日付がJSTでは翌日になる時刻を正しく繰り上げる', () => {
    // UTC 2026-09-27T15:30 = JST 2026-09-28T00:30
    expect(toJstDateIso(new Date('2026-09-27T15:30:00Z'))).toBe('2026-09-28');
  });
});

describe('hashString', () => {
  it('同じ文字列は同じハッシュ、違う文字列は(基本的に)違うハッシュになる', () => {
    expect(hashString('a|b')).toBe(hashString('a|b'));
    expect(hashString('a|b')).not.toBe(hashString('a|c'));
  });
});
