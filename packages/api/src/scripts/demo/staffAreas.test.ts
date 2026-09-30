import { haversineMeters } from '@katahimo/core/domain';
import { STAFF_ROLES } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_FIGURES } from './figures';
import { areaFigureIndexes, DEMO_STAFF_AREAS } from './staffAreas';

const KANSAI_PREFECTURES = ['大阪府', '京都府', '兵庫県', '奈良県', '滋賀県', '和歌山県'];

describe('デモのスタッフの自宅と担当の地域', () => {
  it('3人とも自宅は関西圏', () => {
    for (const role of STAFF_ROLES) {
      const area = DEMO_STAFF_AREAS[role];
      expect(KANSAI_PREFECTURES.some((p) => area.address.startsWith(p))).toBe(true);
    }
  });

  it('担当は役割の間で重ならない(同じお客様を同じ時刻に2人が訪問しない)', () => {
    const all = STAFF_ROLES.flatMap((role) => areaFigureIndexes(role));
    expect(new Set(all).size).toBe(all.length);
  });

  it('担当の世帯どうしは直線で20km 以内、自宅からも20km 以内(1日3件を回れる)', () => {
    for (const role of STAFF_ROLES) {
      const home = DEMO_STAFF_AREAS[role];
      const area = areaFigureIndexes(role);
      expect(area.length).toBeGreaterThanOrEqual(3);
      for (const a of area) {
        const fa = DEMO_FIGURES[a];
        if (!fa) throw new Error(`世帯が無い: ${a}`);
        expect(haversineMeters(home, fa)).toBeLessThan(20_000);
        for (const b of area) {
          const fb = DEMO_FIGURES[b];
          if (!fb) throw new Error(`世帯が無い: ${b}`);
          expect(haversineMeters(fa, fb)).toBeLessThan(20_000);
        }
      }
    }
  });
});
