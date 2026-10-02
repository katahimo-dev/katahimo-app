import type { DemoConfigResponse } from '@katahimo/shared';
import { useQuery } from '@tanstack/react-query';
import { demoApi } from '../../../api/demo';
import { queryKeys } from '../../../api/queryKeys';

const DISABLED: DemoConfigResponse = { enabled: false };

export interface DemoConfigState {
  /** 公開デモの設定。読み込み前・失敗したときは `{ enabled: false }`(デモの表示を出さない)。 */
  config: DemoConfigResponse;
  /** まだ読み込んでいる(失敗も含めて結果が出ていない)。 */
  pending: boolean;
}

/**
 * 公開デモの表示の設定(GET /api/demo/config。ログイン不要)。ログイン画面とログイン後の画面(注釈・帯)で共有する。
 * 起動中に変わらないので読み直さない。失敗はデモではない扱い(本番の利用者にデモの表示を出さない側に倒す)。
 */
export function useDemoConfig(): DemoConfigState {
  const query = useQuery({
    queryKey: queryKeys.demoConfig,
    queryFn: ({ signal }) => demoApi.config(signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return { config: query.data ?? DISABLED, pending: query.isPending };
}
