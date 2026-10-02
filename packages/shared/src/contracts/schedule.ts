import { z } from 'zod';
import { businessDateSchema, idSchema } from './common';

/**
 * 「今日/明日の予定」API(GET /api/schedule・GET /api/schedule/route)の応答。
 * 形はGAS版 Schedule.js(getScheduleForDate / getRouteForStaffOnDate)の戻り値と同じ
 * (packages/core/src/ports/schedule.ts の ScheduleLightResult / ScheduleWithRouteResult)。
 *
 * 実装がGASブリッジのときはGAS版の値がそのまま届くため、項目の欠けや型の揺れ(移動時間が
 * 数値か空文字か等)があっても画面が止まらないよう、文字列・数値の項目は既定値を持たせている。
 */

const text = z
  .string()
  .nullish()
  .transform((v) => v ?? '');
/** 移動時間(分)・距離(km)。算出できない区間は ''。GAS版は数値と toFixed(2) の文字列が混ざる。 */
const minOrKm = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => v ?? '');

/** 道順を開く URL の先頭(Google マップの https の URL だけを画面のリンクにする)。 */
export const GOOGLE_MAPS_URL_PREFIX = 'https://www.google.com/maps/';

/** Google マップの https の URL か(道順のリンクに使ってよいか)。 */
export function isGoogleMapsUrl(value: string): boolean {
  return value.startsWith(GOOGLE_MAPS_URL_PREFIX);
}

/**
 * 区間の道順の URL。サーバー(core の summarizeLeg)は GOOGLE_MAPS_URL_PREFIX の URL だけを作るが、GAS Bridge の値は
 * そのまま届くため、それ以外の値(別のサイト・`javascript:` 等)は '' にする(画面にリンクを出さない。応答を 500 にはしない)。
 */
const mapsUrl = text.transform((v) => (isGoogleMapsUrl(v) ? v : ''));

/** 'CUSTOMER APPOINTMENT' / 'OFFICE WORK' / 'EVENT'(それ以外もありうるため文字列のまま)。 */
const eventType = text;

/** ルート・移動時間を含まない軽量版の1件(GAS版 getScheduleForStaffOnDate)。 */
export const scheduleAppointmentLightSchema = z.object({
  title: text,
  eventType,
  /** 'HH:mm' */
  start: text,
  /** 'HH:mm' */
  end: text,
  address: text,
});
export type ScheduleAppointmentLightView = z.infer<typeof scheduleAppointmentLightSchema>;

export const scheduleLightResponseSchema = z.object({
  success: z.boolean(),
  date: z.string().optional(),
  staffName: z.string().optional(),
  appointments: z.array(scheduleAppointmentLightSchema).optional(),
  message: z.string().optional(),
  /** 読めないカレンダーがあり、予定が欠けているかもしれない(閲覧だけ。画面は前回の表示を置き換えない) */
  partial: z.boolean().optional(),
});
export type ScheduleLightResponse = z.infer<typeof scheduleLightResponseSchema>;

/** ルート・移動時間つきの1件(GAS版 getScheduleWithRouteForStaffOnDate)。 */
export const scheduleAppointmentWithRouteSchema = z.object({
  eventType,
  customerName: text,
  startTime: text,
  endTime: text,
  reservaUrl: text,
  moveUrl: mapsUrl,
  moveMin: minOrKm,
  moveKm: minOrKm,
  attendanceUrl: mapsUrl,
  attendanceMin: minOrKm,
  attendanceKm: minOrKm,
  leavingUrl: mapsUrl,
  leavingMin: minOrKm,
  leavingKm: minOrKm,
  /** RESERVAの顧客ID(customers.external_id)。 */
  customerId: text,
  address: text,
});
export type ScheduleAppointmentWithRouteView = z.infer<typeof scheduleAppointmentWithRouteSchema>;

export const scheduleWithRouteResponseSchema = z.object({
  success: z.boolean(),
  date: z.string().optional(),
  staffName: z.string().optional(),
  appointments: z.array(scheduleAppointmentWithRouteSchema).optional(),
  message: z.string().optional(),
  /** scheduleLightResponseSchema.partial と同じ */
  partial: z.boolean().optional(),
});
export type ScheduleWithRouteResponse = z.infer<typeof scheduleWithRouteResponseSchema>;

// ── クエリ ──────────────────────────────────────────────────

/** GET /api/schedule・GET /api/schedule/route のクエリ。staffId は管理者・コーディネーターだけが有効。 */
export const scheduleQuerySchema = z.object({
  date: businessDateSchema,
  staffId: idSchema.optional(),
});

/** GET /api/schedule/route。予定は毎回カレンダーから読む。forceRefresh=1 で地図の結果のキャッシュも使わずに再計算する(回数制限あり)。 */
export const scheduleRouteQuerySchema = scheduleQuerySchema.extend({
  forceRefresh: z.enum(['0', '1']).optional(),
});
