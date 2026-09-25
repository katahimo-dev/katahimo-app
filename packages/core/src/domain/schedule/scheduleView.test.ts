import { describe, expect, it } from 'vitest';
import { appointment, jst } from './__fixtures__/builders';
import { UNKNOWN_LEG } from './routeLegs';
import { toAppointmentWithRoute, toLightAppointment } from './scheduleView';

describe('scheduleView', () => {
  const visit = appointment({
    start: jst('2026-09-25 09:05'),
    end: jst('2026-09-25 11:35'),
    reservaUrl: 'https://reserva.be/x',
  });

  it('軽量版はタイトル・種別・JSTの時刻・住所', () => {
    expect(toLightAppointment(visit)).toEqual({
      title: '山田 花子',
      eventType: 'CUSTOMER APPOINTMENT',
      start: '09:05',
      end: '11:35',
      address: '東京都世田谷区三軒茶屋1-2-3',
    });
  });

  it('ルートつきはGAS版と同じ項目名で、算出できない区間は空文字', () => {
    const attendance = { url: 'https://www.google.com/maps/dir/?api=1&x', min: 25, km: '8.10' };
    expect(toAppointmentWithRoute(visit, { attendance, move: UNKNOWN_LEG, leaving: UNKNOWN_LEG })).toEqual({
      eventType: 'CUSTOMER APPOINTMENT',
      customerName: '山田 花子',
      startTime: '09:05',
      endTime: '11:35',
      reservaUrl: 'https://reserva.be/x',
      moveUrl: '',
      moveMin: '',
      moveKm: '',
      attendanceUrl: attendance.url,
      attendanceMin: 25,
      attendanceKm: '8.10',
      leavingUrl: '',
      leavingMin: '',
      leavingKm: '',
      customerId: 'C0001',
      address: '東京都世田谷区三軒茶屋1-2-3',
    });
  });
});
