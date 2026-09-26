import { scheduleLightResponseSchema, scheduleWithRouteResponseSchema } from '@katahimo/shared';
import { api } from './client';

export interface ScheduleRequest {
  /** 'YYYY-MM-DD'(JSTの業務日) */
  date: string;
  /** 管理者が他のスタッフを見るときだけ(useAdminTargetStaff().requestStaffId) */
  staffId?: string;
}

/** 「今日/明日の予定」API(doc/04_API仕様.md 2.4)。 */
export const scheduleApi = {
  /** GET /api/schedule: ルートなしの予定(GAS版 getScheduleForDate)。ルートの自動取得に失敗したときに使う。 */
  get: ({ date, staffId }: ScheduleRequest, signal?: AbortSignal) =>
    api.get('/api/schedule', scheduleLightResponseSchema, { date, staffId }, { signal }),
  /**
   * GET /api/schedule/route: ルート・移動時間つきの予定(GAS版 getRouteForStaffOnDate)。
   * forceRefresh は「🔄 最新にする」を押したとき(サーバーの共有キャッシュを使わずに調べ直す)。
   */
  getWithRoute: ({ date, staffId }: ScheduleRequest, forceRefresh: boolean, signal?: AbortSignal) =>
    api.get(
      '/api/schedule/route',
      scheduleWithRouteResponseSchema,
      { date, staffId, forceRefresh: forceRefresh ? '1' : undefined },
      { signal },
    ),
};
