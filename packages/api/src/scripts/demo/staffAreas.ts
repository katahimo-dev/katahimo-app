import type { StaffRole } from '@katahimo/shared';
import { DEMO_FIGURES } from './figures';

/**
 * デモのスタッフの自宅と担当の地域(公開デモの `pnpm demo:reset` 専用)。
 *
 * デモの20世帯は関西の各地(大阪・京都・兵庫・奈良・滋賀・和歌山)にいるため、訪問先を全世帯から選ぶと
 * 1日の移動が100km を超えることがある。スタッフの自宅を大阪市・京都市・神戸市に分け、それぞれ自宅の近くの
 * 世帯だけを担当する(予定・出勤簿・日報の履歴が同じ地域で揃う)。担当は役割の間で重ならない(同じお客様を
 * 同じ時刻に2人が訪問しないように)。担当の世帯どうしは直線で20km 以内で、見積もりの移動(車)が訪問の間
 * (60分・90分)に収まる。
 */
export interface DemoStaffArea {
  /** 自宅の架空の住所(関西圏)。 */
  address: string;
  lat: number;
  lng: number;
  /** 担当の世帯(DEMO_FIGURES の externalId)。1日の訪問(最大3件)を選ぶ候補になる。 */
  households: readonly string[];
}

/**
 * 役割ごとの自宅と担当。SCHEDULE_PROVIDER=database は住所をジオコーディングしないので緯度経度も入れる
 * (無いと出勤・退勤の区間が空欄になり、「予定から反映」で出勤簿の出勤・退勤の距離も空欄になる)。
 */
export const DEMO_STAFF_AREAS: Readonly<Record<StaffRole, DemoStaffArea>> = {
  // 大阪市(大阪・堺・尼崎。日報の履歴もこの人)
  staff: {
    address: '大阪府大阪市西区靱本町1-1-1',
    lat: 34.6853,
    lng: 135.4935,
    households: ['PD-0001', 'PD-0002', 'PD-0003', 'PD-0004', 'PD-0014'],
  },
  // 京都市(京都・亀岡)
  coordinator: {
    address: '京都府京都市中京区烏丸御池1-1-1',
    lat: 35.0105,
    lng: 135.7596,
    households: ['PD-0006', 'PD-0007', 'PD-0008', 'PD-0009', 'PD-0010'],
  },
  // 神戸市(兵庫区・須磨区・垂水区)
  admin: {
    address: '兵庫県神戸市中央区三宮町1-1-1',
    lat: 34.6913,
    lng: 135.1937,
    households: ['PD-0011', 'PD-0012', 'PD-0013'],
  },
};

/** その役割のスタッフが担当する世帯(DEMO_FIGURES の index)。 */
export function areaFigureIndexes(role: StaffRole): number[] {
  return DEMO_STAFF_AREAS[role].households.map((externalId) => {
    const index = DEMO_FIGURES.findIndex((f) => f.externalId === externalId);
    if (index < 0) throw new Error(`デモの担当の世帯が見つかりません: ${externalId}`);
    return index;
  });
}
