import { type DayDetailField, type DayRecord, isSlotFilled } from './dayRecord';

/**
 * 「移動と距離・買い物代行・備考」パネルの区間(GAS版 buildPastScheduleMoveGroups_)。
 *
 * その日に入っている訪問(1〜3件目のうち始め・終わりの両方があるもの)に合わせて区間を出す:
 * - 1件目があれば「🏠 家 → 1件目」(距離・天候〈1件目の後〉)
 * - 2件目があれば「1件目 → 2件目」(時間・距離・天候〈2件目の後〉)
 * - 3件目があれば「2件目 → 3件目」(時間・距離)
 * - 1件目があれば「最後の訪問 → 🏠 家」(距離)
 * 見出しは訪問先の名前(空なら #1〜#3)。
 */
export interface MoveNumberField {
  field: DayDetailField;
  label: '距離（km）' | '時間（分）';
}

export interface MoveGroup {
  title: string;
  numberFields: MoveNumberField[];
  /** 天候のボタンを出す場合の項目と、選択肢の種類(API の optionsI / optionsR) */
  weather?: { field: 'visit1Weather' | 'visit2Weather'; options: 'visit1' | 'visit2' };
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
      weather: { field: 'visit1Weather', options: 'visit1' },
    });
  }
  if (v2Filled) {
    groups.push({
      title: `${v1Name} → ${v2Name}`,
      numberFields: [
        { field: 'leg12Minutes', label: '時間（分）' },
        { field: 'leg12Km', label: '距離（km）' },
      ],
      weather: { field: 'visit2Weather', options: 'visit2' },
    });
  }
  if (v3Filled) {
    groups.push({
      title: `${v2Name} → ${v3Name}`,
      numberFields: [
        { field: 'leg23Minutes', label: '時間（分）' },
        { field: 'leg23Km', label: '距離（km）' },
      ],
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

/** 区間に出ている項目 + 買い物代行・備考(保存時に空で送らない項目)。 */
export function shownDetailFields(groups: readonly MoveGroup[]): Set<DayDetailField> {
  const fields = new Set<DayDetailField>(['shoppingCount', 'remarks']);
  for (const g of groups) {
    for (const f of g.numberFields) fields.add(f.field);
    if (g.weather) fields.add(g.weather.field);
  }
  return fields;
}

/** 天候の選択肢が空のときの既定(GAS版 pastScheduleWeatherToggleHtml_) */
export const DEFAULT_WEATHER_OPTIONS = ['晴れ', '曇り', '雨', '雪'] as const;

export function weatherOptionsOrDefault(options: readonly string[] | undefined): readonly string[] {
  return options && options.length > 0 ? options : DEFAULT_WEATHER_OPTIONS;
}

/** 同じボタンをもう一度押すと選択を外す(GAS版 setPastScheduleWeather_) */
export function toggleWeather(current: string, pressed: string): string {
  return current === pressed ? '' : pressed;
}

/** 買い物代行をした回数の確認(空か0以上の整数)。GAS版 savePastScheduleDetail。 */
export function isValidShoppingCount(raw: string): boolean {
  return raw === '' || /^\d+$/.test(raw);
}
