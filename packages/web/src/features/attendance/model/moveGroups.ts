import { type DayDetailField, type DayRecord, isSlotFilled } from './dayRecord';

/**
 * 「移動と距離・買い物代行・備考」パネルの区間(GAS版 buildPastScheduleMoveGroups_)。
 *
 * その日に入っている訪問(1〜3件目のうち始め・終わりの両方があるもの)に合わせて区間を出す:
 * - 1件目があれば「🏠 家 → 1件目」(距離)
 * - 2件目があれば「1件目 → 2件目」(時間・距離・雪〈I列〉)
 * - 3件目があれば「2件目 → 3件目」(時間・距離・雪〈R列〉)
 * - 1件目があれば「最後の訪問 → 🏠 家」(距離)
 * 見出しは訪問先の名前(空なら #1〜#3)。
 *
 * 天候の列(I/R)が計算に効くのは「雪」のときだけ(その区間の移動時間 × 1.3)で、I列は H列(1件目 → 2件目の時間)、
 * R列は Q列(2件目 → 3件目の時間)に掛かる。GAS版は天候のボタンを1つ手前の区間(I を「家 → 1件目」、R を「1件目 → 2件目」)に
 * 出していたため、押した区間と1.3倍になる区間がずれていた。ここでは効く区間に「雪」のチェックだけを出す。
 */
export interface MoveNumberField {
  field: DayDetailField;
  label: '距離（km）' | '時間（分）';
}

export interface MoveGroup {
  title: string;
  numberFields: MoveNumberField[];
  /** 「雪」のチェックを出す場合の項目(この区間の移動時間を1.3倍にする天候の列) */
  snow?: { field: 'leg12Weather' | 'leg23Weather' };
}

export function buildMoveGroups(record: DayRecord): MoveGroup[] {
  const { slot1, slot2, slot3 } = record.slots;
  const v1Filled = isSlotFilled(slot1);
  const v2Filled = isSlotFilled(slot2);
  const v3Filled = isSlotFilled(slot3);

  const nameOf = (name: string, fallback: string) => name.trim() || fallback;
  const v1Name = nameOf(slot1.name, '#1');
  const v2Name = nameOf(slot2.name, '#2');
  const v3Name = nameOf(slot3.name, '#3');
  const lastName = v3Filled ? v3Name : v2Filled ? v2Name : v1Name;

  const groups: MoveGroup[] = [];
  if (v1Filled) {
    groups.push({
      title: `🏠 家 → ${v1Name}`,
      numberFields: [{ field: 'commuteKm', label: '距離（km）' }],
    });
  }
  if (v2Filled) {
    groups.push({
      title: `${v1Name} → ${v2Name}`,
      numberFields: [
        { field: 'leg12Minutes', label: '時間（分）' },
        { field: 'leg12Km', label: '距離（km）' },
      ],
      snow: { field: 'leg12Weather' },
    });
  }
  if (v3Filled) {
    groups.push({
      title: `${v2Name} → ${v3Name}`,
      numberFields: [
        { field: 'leg23Minutes', label: '時間（分）' },
        { field: 'leg23Km', label: '距離（km）' },
      ],
      snow: { field: 'leg23Weather' },
    });
  }
  if (v1Filled) {
    groups.push({
      title: `${lastName} → 🏠 家`,
      numberFields: [{ field: 'leavingKm', label: '距離（km）' }],
    });
  }
  return groups;
}

/**
 * 区間に出ている項目 + 買い物代行・備考・天候(保存時に空で送らない項目)。
 * 天候(I/R)は区間が出ていなくても今の値のまま送る: 以前はI列を「家 → 1件目」に出していたため、訪問1件の日にも
 * 晴れ等が入っていることがあり、それを消さない(時間の列が空の区間では計算に効かない)。
 */
export function shownDetailFields(groups: readonly MoveGroup[]): Set<DayDetailField> {
  const fields = new Set<DayDetailField>(['shoppingCount', 'remarks', 'leg12Weather', 'leg23Weather']);
  for (const g of groups) {
    for (const f of g.numberFields) fields.add(f.field);
    if (g.snow) fields.add(g.snow.field);
  }
  return fields;
}

/** 移動時間を1.3倍にする天候(出勤簿テンプレートの IF(I="雪", H*1.3, H))。 */
export const SNOW_WEATHER = '雪';

/** 天候の列の値が「雪」か(晴れ・曇り・雨・空はどれも計算に効かないので、チェックなしとして出す)。 */
export function isSnow(weather: string): boolean {
  return weather === SNOW_WEATHER;
}

/**
 * 「雪」のチェックを変えたときの天候の列の値。付ければ「雪」、外せば空。
 * チェックを触らなければ前の値(以前に入れた晴れ・曇り・雨を含む)をそのまま送る。
 */
export function snowWeatherValue(checked: boolean): string {
  return checked ? SNOW_WEATHER : '';
}

/** 買い物代行をした回数の確認(空か0以上の整数)。GAS版 savePastScheduleDetail。 */
export function isValidShoppingCount(raw: string): boolean {
  return raw === '' || /^\d+$/.test(raw);
}
