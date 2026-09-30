import { haversineMeters } from '@katahimo/core/domain';
import type { StaffRole } from '@katahimo/shared';
import { DEMO_FIGURES } from './figures';

/**
 * デモのスタッフの自宅と担当の地域(公開デモの `pnpm demo:reset` 専用)。
 *
 * デモの20世帯は関西の各地(大阪・京都・兵庫・奈良・滋賀・和歌山)にいるため、訪問先を全世帯から選ぶと
 * 1日の移動が100km を超えることがある。スタッフの自宅を大阪市・京都市・尼崎市に分け、それぞれ自宅に近い世帯だけを
 * 訪問するようにする(予定・出勤簿・日報の履歴が同じ地域で揃う)。
 */
export interface DemoStaffHome {
  /** 架空の住所(関西圏)。 */
  address: string;
  lat: number;
  lng: number;
}

/**
 * 役割ごとの自宅。SCHEDULE_PROVIDER=database は住所をジオコーディングしないので緯度経度も入れる
 * (無いと出勤・退勤の区間が空欄になり、「予定から反映」で出勤簿の出勤・退勤の距離も空欄になる)。
 */
export const DEMO_STAFF_HOMES: Readonly<Record<StaffRole, DemoStaffHome>> = {
  // 大阪市(大阪・尼崎・堺の世帯を回る。日報の履歴もこの人)
  staff: { address: '大阪府大阪市西区靱本町1-1-1', lat: 34.6853, lng: 135.4935 },
  // 京都市(京都・亀岡の世帯を回る)
  coordinator: { address: '京都府京都市中京区烏丸御池1-1-1', lat: 35.0105, lng: 135.7596 },
  // 尼崎市(尼崎・大阪・堺の世帯を回る)
  admin: { address: '兵庫県尼崎市昭和通2-1-1', lat: 34.724, lng: 135.415 },
};

/**
 * 1人が担当する世帯の数(自宅に近い順)。1日の訪問(最大3件)を選ぶ候補になる。担当の世帯どうしは直線で20km 以内に
 * 収まり、見積もりの移動(車)が訪問の間(60分・90分)に収まる。
 */
export const DEMO_AREA_HOUSEHOLD_COUNT = 5;

/** その役割のスタッフが担当する世帯(DEMO_FIGURES の index。自宅に近い順に DEMO_AREA_HOUSEHOLD_COUNT 世帯)。 */
export function areaFigureIndexes(role: StaffRole): number[] {
  const home = DEMO_STAFF_HOMES[role];
  return DEMO_FIGURES.map((figure, index) => ({ index, meters: haversineMeters(home, figure) }))
    .sort((a, b) => a.meters - b.meters || a.index - b.index)
    .slice(0, DEMO_AREA_HOUSEHOLD_COUNT)
    .map((c) => c.index);
}
