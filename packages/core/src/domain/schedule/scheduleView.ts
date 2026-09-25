import type { ScheduleAppointmentLight, ScheduleAppointmentWithRoute } from '../../ports/schedule';
import { formatJstTime } from './jstDate';
import type { LegSummary } from './routeLegs';
import type { Appointment } from './types';

/** 軽量版(ルート無し)の1件。移植元: RouteSearch.js getScheduleForStaffOnDate の appointments。 */
export function toLightAppointment(appointment: Appointment): ScheduleAppointmentLight {
  return {
    title: appointment.name,
    eventType: appointment.type,
    start: formatJstTime(appointment.start),
    end: formatJstTime(appointment.end),
    address: appointment.place.address,
  };
}

export interface AppointmentLegs {
  attendance: LegSummary;
  move: LegSummary;
  leaving: LegSummary;
}

/** ルートつきの1件。移植元: RouteSearch.js getScheduleWithRouteForStaffOnDate の appointments。 */
export function toAppointmentWithRoute(
  appointment: Appointment,
  legs: AppointmentLegs,
): ScheduleAppointmentWithRoute {
  return {
    eventType: appointment.type,
    customerName: appointment.name,
    startTime: formatJstTime(appointment.start),
    endTime: formatJstTime(appointment.end),
    reservaUrl: appointment.reservaUrl,
    moveUrl: legs.move.url,
    moveMin: legs.move.min,
    moveKm: legs.move.km,
    attendanceUrl: legs.attendance.url,
    attendanceMin: legs.attendance.min,
    attendanceKm: legs.attendance.km,
    leavingUrl: legs.leaving.url,
    leavingMin: legs.leaving.min,
    leavingKm: legs.leaving.km,
    customerId: appointment.customerId,
    address: appointment.place.address,
  };
}
