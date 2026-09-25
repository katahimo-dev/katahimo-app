import { dataVersionResponseSchema, uiConfigResponseSchema } from '@katahimo/shared';
import { api } from './client';

export const systemApi = {
  /** GET /api/data-version: 顧客データの版数(GAS版 checkDataVersion)。 */
  dataVersion: (signal?: AbortSignal) =>
    api.get('/api/data-version', dataVersionResponseSchema, undefined, { signal }),
  /** GET /api/ui-config: 日報画面の文言・評価の定義(GAS版 getUiConfig)。 */
  uiConfig: (signal?: AbortSignal) =>
    api.get('/api/ui-config', uiConfigResponseSchema, undefined, { signal }),
};
