import type { TenantCalendarSettings } from '../domain/schedule/calendarPolicy';
import type { Place, ScheduleCustomer } from '../domain/schedule/types';
import type { TravelMode } from './maps';

/** 予定計算に使うスタッフ(自宅の位置・移動手段)。 */
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
  /** 共有カレンダーと、スタッフに設定できるカレンダーの許可(運用担当者が設定する)。 */
  calendarSettings: TenantCalendarSettings;
}

export interface ScheduleDirectoryPort {
  load(tenantId: string): Promise<ScheduleDirectory>;
}
