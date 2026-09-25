import type { Place, ScheduleCustomer } from '../domain/schedule/types';
import type { TravelMode } from './maps';

/** 復号済みのスタッフ(予定計算用)。 */
export interface ScheduleStaff {
  id: string;
  name: string;
  home: Place;
  travelMode: TravelMode;
  calendarId: string | null;
}

/** 予定計算の入力になるマスタ一式(GAS版の顧客CSV+スタッフ台帳に相当)。 */
export interface ScheduleDirectory {
  staff: ScheduleStaff[];
  customers: ScheduleCustomer[];
}

export interface ScheduleDirectoryPort {
  load(tenantId: string): Promise<ScheduleDirectory>;
}
