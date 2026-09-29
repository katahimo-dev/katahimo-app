import { describe, expect, it } from 'vitest';
import { appointment, jst } from './__fixtures__/builders';
import {
  ESTIMATED_ROAD_FACTOR,
  estimateLegSummary,
  estimatePlanLegs,
  estimateRouteLeg,
  haversineMeters,
} from './estimatedLeg';
import { planRouteLegs, UNKNOWN_LEG } from './routeLegs';
import type { Place } from './types';

// 大阪城付近と北浜付近(直線で約1.3km)
const osakaCastle = { lat: 34.6863, lng: 135.5259 };
const kitahama = { lat: 34.6925, lng: 135.5075 };
const at = (latLng: { lat: number; lng: number } | null, address = '住所'): Place => ({ address, latLng });

describe('haversineMeters', () => {
  it('同じ点は0、緯度1度はおよそ111km', () => {
    expect(haversineMeters(osakaCastle, osakaCastle)).toBe(0);
    expect(haversineMeters({ lat: 34, lng: 135 }, { lat: 35, lng: 135 })).toBeCloseTo(111_195, -2);
  });
});

describe('estimateRouteLeg', () => {
  it('直線距離に道なりの係数を掛け、移動手段の速さで時間にする', () => {
    const straight = haversineMeters(osakaCastle, kitahama);
    const car = estimateRouteLeg(osakaCastle, kitahama, 'car');
    expect(car.distanceMeters).toBeCloseTo(straight * ESTIMATED_ROAD_FACTOR, 6);
    // 25km/h
    expect(car.durationSeconds).toBeCloseTo((car.distanceMeters / 25_000) * 3600, 6);
    const walk = estimateRouteLeg(osakaCastle, kitahama, 'walk');
    expect(walk.distanceMeters).toBe(car.distanceMeters);
    expect(walk.durationSeconds).toBeGreaterThan(car.durationSeconds);
  });
});

describe('estimateLegSummary', () => {
  it('分に四捨五入・kmは小数2桁の文字列・URL は地図の経路の形', () => {
    const leg = estimateLegSummary({ from: at(osakaCastle), to: at(kitahama) }, '2026-09-29', 'car');
    const raw = estimateRouteLeg(osakaCastle, kitahama, 'car');
    expect(leg).toEqual({
      url:
        'https://www.google.com/maps/dir/?api=1&origin=34.6863,135.5259&destination=34.6925,135.5075' +
        '&travelmode=driving',
      min: Math.round(raw.durationSeconds / 60),
      km: (raw.distanceMeters / 1000).toFixed(2),
    });
  });

  it('区間が無い・緯度経度が無い・住所2の適用期間中は算出不可', () => {
    expect(estimateLegSummary(null, '2026-09-29', 'car')).toEqual(UNKNOWN_LEG);
    expect(estimateLegSummary({ from: at(null), to: at(kitahama) }, '2026-09-29', 'car')).toEqual(
      UNKNOWN_LEG,
    );
    const temporary: Place = {
      ...at(kitahama),
      temporaryAddress: { address: '別の住所', startDate: '2026-09-01', endDate: '2026-09-30' },
    };
    expect(estimateLegSummary({ from: at(osakaCastle), to: temporary }, '2026-09-29', 'car')).toEqual(
      UNKNOWN_LEG,
    );
    expect(estimateLegSummary({ from: at(osakaCastle), to: temporary }, '2026-10-01', 'car').km).not.toBe('');
  });
});

describe('estimatePlanLegs', () => {
  it('出勤・移動・退勤の3区間を見積もる(自宅に緯度経度が無ければ出勤・退勤は算出不可)', () => {
    const a = appointment({ name: 'A', start: jst('2026-09-29 10:00'), place: at(osakaCastle) });
    const b = appointment({ name: 'B', start: jst('2026-09-29 13:00'), place: at(kitahama) });
    const [first, second] = planRouteLegs([a, b], at(null, ''));
    if (!first || !second) throw new Error('区間の計画がありません');
    expect(estimatePlanLegs(first, '2026-09-29', 'car')).toEqual({
      attendance: UNKNOWN_LEG,
      move: UNKNOWN_LEG,
      leaving: UNKNOWN_LEG,
    });
    const legs = estimatePlanLegs(second, '2026-09-29', 'bicycle');
    expect(legs.attendance).toEqual(UNKNOWN_LEG);
    expect(legs.leaving).toEqual(UNKNOWN_LEG);
    expect(legs.move.url).toContain('travelmode=bicycling');
    expect(Number(legs.move.km)).toBeGreaterThan(1);
  });
});
