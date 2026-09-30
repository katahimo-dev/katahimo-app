import { describe, expect, it } from 'vitest';
import { detailPatch, slotPatch, toDayRecord } from './dayRecord';
import {
  buildMoveGroups,
  isSnow,
  isValidShoppingCount,
  shownDetailFields,
  snowWeatherValue,
} from './moveGroups';

const threeVisits = {
  C: '田中',
  D: '09:30',
  E: '11:30',
  L: '佐々木',
  M: '12:30',
  N: '14:30',
  U: '高橋',
  V: '16:00',
  W: '17:30',
  AI: '6.2',
  I: '晴れ',
  H: '25',
  AG: '8.4',
  R: '雨',
  Q: '40',
  AH: '15.3',
  AJ: '12.8',
  AN: '1',
  AO: 'メモ',
};

describe('移動と距離の区間(buildPastScheduleMoveGroups_)', () => {
  it('訪問3件: 家→1件目(距離)、1→2(時間・距離・雪I)、2→3(時間・距離・雪R)、3件目→家(距離)', () => {
    const groups = buildMoveGroups(toDayRecord(threeVisits));
    expect(groups.map((g) => g.title)).toEqual([
      '🏠 家 → 田中',
      '田中 → 佐々木',
      '佐々木 → 高橋',
      '高橋 → 🏠 家',
    ]);
    expect(groups.map((g) => g.numberFields.map((f) => f.field))).toEqual([
      ['commuteKm'],
      ['leg12Minutes', 'leg12Km'],
      ['leg23Minutes', 'leg23Km'],
      ['leavingKm'],
    ]);
    // 雪のチェックは1.3倍になる移動時間と同じ区間に出す(I は H、R は Q に掛かる)
    expect(groups.map((g) => g.snow?.field)).toEqual([undefined, 'leg12Weather', 'leg23Weather', undefined]);
  });
  it('訪問1件: 家→1件目 と 1件目→家 だけ。名前が空なら #1', () => {
    const groups = buildMoveGroups(toDayRecord({ D: '10:00', E: '12:00' }));
    expect(groups.map((g) => g.title)).toEqual(['🏠 家 → #1', '#1 → 🏠 家']);
  });
  it('訪問が無ければ区間なし(時刻が片方だけでも入っていないとみなす)', () => {
    expect(buildMoveGroups(toDayRecord({ C: '田中', D: '10:00' }))).toEqual([]);
  });
  it('2件目まで: 最後は2件目 → 家', () => {
    const groups = buildMoveGroups(toDayRecord({ ...threeVisits, V: '', W: '' }));
    expect(groups.at(-1)?.title).toBe('佐々木 → 🏠 家');
  });
});

describe('保存するときに送る列', () => {
  it('予定1つ分は名前・始め・終わりの列だけ', () => {
    expect(slotPatch('office2', { name: '研修', start: '13:00', end: '14:00' })).toEqual({
      AA: '研修',
      AB: '13:00',
      AC: '14:00',
    });
  });
  it('出ていない区間の欄は空で送る(GAS版と同じ)。天候は消さずに今の値のまま送る', () => {
    const record = toDayRecord({ ...threeVisits, M: '', N: '', V: '', W: '' });
    const shown = shownDetailFields(buildMoveGroups(record));
    expect(detailPatch(record.detail, shown)).toEqual({
      AI: '6.2',
      I: '晴れ',
      H: '',
      AG: '',
      R: '雨',
      Q: '',
      AH: '',
      AJ: '12.8',
      AN: '1',
      AO: 'メモ',
    });
  });
});

describe('雪・買い物代行', () => {
  it('チェックが付くのは「雪」のときだけ(晴れ・曇り・雨・空は付かない)', () => {
    expect(isSnow('雪')).toBe(true);
    for (const w of ['', '晴れ', '曇り', '雨']) expect(isSnow(w)).toBe(false);
  });
  it('付ければ「雪」、外せば空', () => {
    expect(snowWeatherValue(true)).toBe('雪');
    expect(snowWeatherValue(false)).toBe('');
  });
  it('2件目までの日は 2→3 の時間を空で送るが、天候(R)は今の値のまま送る', () => {
    const record = toDayRecord({ ...threeVisits, I: '雪', R: '雪', V: '', W: '' });
    const patch = detailPatch(record.detail, shownDetailFields(buildMoveGroups(record)));
    expect(patch.I).toBe('雪');
    expect(patch.Q).toBe('');
    expect(patch.R).toBe('雪');
  });
  it('買い物代行は空か0以上の整数', () => {
    expect(isValidShoppingCount('')).toBe(true);
    expect(isValidShoppingCount('0')).toBe(true);
    expect(isValidShoppingCount('1.5')).toBe(false);
    expect(isValidShoppingCount('-1')).toBe(false);
  });
});
