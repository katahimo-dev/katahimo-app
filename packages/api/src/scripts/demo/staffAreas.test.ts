import { haversineMeters } from '@katahimo/core/domain';
import { STAFF_ROLES } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_FIGURES } from './figures';
import { areaFigureIndexes, DEMO_AREA_HOUSEHOLD_COUNT, DEMO_STAFF_HOMES } from './staffAreas';

const KANSAI_PREFECTURES = ['大阪府', '京都府', '兵庫県', '奈良県', '滋賀県', '和歌山県'];

describe('デモのスタッフの自宅と担当の地域', () => {
  it('3人とも自宅は関西圏', () => {
    for (const role of STAFF_ROLES) {
      const home = DEMO_STAFF_HOMES[role];
      expect(KANSAI_PREFECTURES.some((p) => home.address.startsWith(p))).toBe(true);
    }
  });

  it('担当は自宅に近い世帯だけ(担当の世帯どうしは直線で20km 以内)', () => {
    for (const role of STAFF_ROLES) {
      const area = areaFigureIndexes(role);
      expect(area).toHaveLength(DEMO_AREA_HOUSEHOLD_COUNT);
      for (const a of area) {
        for (const b of area) {
          const fa = DEMO_FIGURES[a];
          const fb = DEMO_FIGURES[b];
          if (!fa || !fb) throw new Error(`世帯が無い: ${a}, ${b}`);
          expect(haversineMeters(fa, fb)).toBeLessThan(20_000);
        }
      }
    }
  });
});
