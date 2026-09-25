import { describe, expect, it } from 'vitest';
import { appointment, jst } from './__fixtures__/builders';
import { planRouteLegs, summarizeLeg } from './routeLegs';
import type { Appointment, Place } from './types';

const home: Place = { address: '東京都世田谷区用賀4-1-1', latLng: null };
const located = (name: string, time: string) =>
  appointment({ name, start: jst(`2026-09-25 ${time}`), place: { address: `${name}の住所`, latLng: null } });
const online = (name: string, time: string) =>
  appointment({ name, start: jst(`2026-09-25 ${time}`), place: { address: '', latLng: null } });

/** 区間を「起点→終点」の住所で表す(読みやすさのため)。 */
function describePlan(appointments: Appointment[]) {
  return planRouteLegs(appointments, home).map((plan) => ({
    name: plan.appointment.name,
    attendance: plan.attendance && `${plan.attendance.from.address}→${plan.attendance.to.address}`,
    move: plan.move && `${plan.move.from.address}→${plan.move.to.address}`,
    leaving: plan.leaving && `${plan.leaving.from.address}→${plan.leaving.to.address}`,
  }));
}

describe('planRouteLegs', () => {
  it('自宅→最初の予定、予定間、最後の予定→自宅', () => {
    expect(describePlan([located('A', '09:00'), located('B', '13:00'), located('C', '16:00')])).toEqual([
      { name: 'A', attendance: '東京都世田谷区用賀4-1-1→Aの住所', move: null, leaving: null },
      { name: 'B', attendance: null, move: 'Aの住所→Bの住所', leaving: null },
      { name: 'C', attendance: null, move: 'Bの住所→Cの住所', leaving: 'Cの住所→東京都世田谷区用賀4-1-1' },
    ]);
  });

  it('予定が1件なら出勤と退勤の両方が付く', () => {
    expect(describePlan([located('A', '09:00')])).toEqual([
      {
        name: 'A',
        attendance: '東京都世田谷区用賀4-1-1→Aの住所',
        move: null,
        leaving: 'Aの住所→東京都世田谷区用賀4-1-1',
      },
    ]);
  });

  it('位置情報の無い予定(オンライン等)は飛ばして前後をつなぎ、先頭・末尾にあっても出勤・退勤は位置情報ありの予定に付く', () => {
    expect(
      describePlan([
        online('オンライン1', '08:00'),
        located('A', '09:00'),
        online('オンライン2', '11:00'),
        located('B', '13:00'),
        online('オンライン3', '18:00'),
      ]),
    ).toEqual([
      { name: 'オンライン1', attendance: null, move: null, leaving: null },
      { name: 'A', attendance: '東京都世田谷区用賀4-1-1→Aの住所', move: null, leaving: null },
      { name: 'オンライン2', attendance: null, move: null, leaving: null },
      { name: 'B', attendance: null, move: 'Aの住所→Bの住所', leaving: 'Bの住所→東京都世田谷区用賀4-1-1' },
      { name: 'オンライン3', attendance: null, move: null, leaving: null },
    ]);
  });

  it('空白だけの住所の予定には、直前の位置情報ありの予定からの移動区間だけ付く(GAS版の分岐のまま)', () => {
    const blank = appointment({
      name: '空白',
      start: jst('2026-09-25 11:00'),
      place: { address: ' ', latLng: null },
    });
    expect(describePlan([located('A', '09:00'), blank])[1]).toEqual({
      name: '空白',
      attendance: null,
      move: 'Aの住所→ ',
      leaving: null,
    });
  });

  it('位置情報ありの予定が無ければ区間は何も無い', () => {
    expect(describePlan([online('X', '09:00')])).toEqual([
      { name: 'X', attendance: null, move: null, leaving: null },
    ]);
    expect(planRouteLegs([], home)).toEqual([]);
  });
});

describe('summarizeLeg', () => {
  const origin = { lat: 35.6437, lng: 139.6708 };
  const destination = { lat: 35.6074, lng: 139.6687 };

  it('分は四捨五入、kmは小数2桁の文字列、URLはGoogleマップの経路URL', () => {
    expect(summarizeLeg(origin, destination, { durationSeconds: 929, distanceMeters: 4235 }, 'car')).toEqual({
      url: 'https://www.google.com/maps/dir/?api=1&origin=35.6437,139.6708&destination=35.6074,139.6687&travelmode=driving',
      min: 15,
      km: '4.24',
    });
  });

  it('0分・0kmも値として返す(空欄にしない)', () => {
    expect(summarizeLeg(origin, origin, { durationSeconds: 0, distanceMeters: 0 }, 'car')).toMatchObject({
      min: 0,
      km: '0.00',
    });
  });

  it('30秒は1分に切り上がり、29秒は0分(Math.round)', () => {
    expect(summarizeLeg(origin, destination, { durationSeconds: 90, distanceMeters: 5 }, 'car').min).toBe(2);
    expect(summarizeLeg(origin, destination, { durationSeconds: 89, distanceMeters: 5 }, 'car').min).toBe(1);
    expect(summarizeLeg(origin, destination, { durationSeconds: 29, distanceMeters: 5 }, 'car').min).toBe(0);
  });

  it.each([
    ['bicycle', 'bicycling'],
    ['transit', 'transit'],
    ['walk', 'walking'],
  ] as const)('移動手段 %s はURLの travelmode=%s', (mode, urlMode) => {
    expect(
      summarizeLeg(origin, destination, { durationSeconds: 60, distanceMeters: 100 }, mode).url,
    ).toContain(`travelmode=${urlMode}`);
  });
});
