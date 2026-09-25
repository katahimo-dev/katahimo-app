import type { Place, ScheduleCustomer } from '../domain/schedule/types';
import type { TravelMode } from './maps';
import type { EncryptedField } from './repositories';

/**
 * 予定・ルート計算に使うスタッフ属性(staffテーブルのうち認証と無関係な列)。
 *
 * 自宅住所の文字列はstaffテーブルに専用列が無いため、当面 custom_fields.homeAddress に置く
 * (GAS版スタッフ台帳の「住所」列に相当。スキーマ凍結中のための暫定。doc/api/schedule-route.md)。
 * 自宅の緯度経度は home_lat_lng_ciphertext('lat,lng' をCryptoPortで暗号化したもの)。
 */
export interface StaffRouteProfileRecord {
  id: string;
  name: string;
  homeAddress: string | null;
  homeLatLng: EncryptedField | null;
  travelMode: TravelMode | null;
  /** 予定を読むGoogleカレンダーID(通常は本人のGoogleアカウントのメールアドレス)。 */
  calendarId: string | null;
  retirementDate: string | null;
}

export interface StaffRouteProfileRepositoryPort {
  /** 退職者も含むテナントの全スタッフ(GAS版スタッフ台帳の全行に相当)。 */
  listByTenant(tenantId: string): Promise<StaffRouteProfileRecord[]>;
}

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
