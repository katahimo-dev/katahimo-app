import { demoConfigResponseSchema } from '@katahimo/shared';
import { api } from './client';

/** 公開デモのAPI(doc/04_API仕様.md)。 */
export const demoApi = {
  /**
   * GET /api/demo/config(ログイン不要): 公開デモの表示の設定(ログイン画面の注意書き・デモ用アカウント、
   * ログイン直後の注釈の保存期間など)。本番とデモは同じビルドなので、デモかどうかはビルドの設定ではなくこれで決める。
   */
  config: (signal?: AbortSignal) =>
    api.get('/api/demo/config', demoConfigResponseSchema, undefined, { signal, skipAuthHandler: true }),
};
