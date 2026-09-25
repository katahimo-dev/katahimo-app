import { activeStaffListResponseSchema } from '@katahimo/shared';
import { api } from './client';

export const staffApi = {
  /** GET /api/staff: 管理者用「表示するスタッフ」の選択肢。管理者以外は空配列。 */
  listActive: (signal?: AbortSignal) =>
    api.get('/api/staff', activeStaffListResponseSchema, undefined, { signal }),
};
