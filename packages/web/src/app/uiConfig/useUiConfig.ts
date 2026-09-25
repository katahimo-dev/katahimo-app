import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { systemApi } from '../../api/system';

/**
 * 日報画面の入力欄の案内文・事故報告のヒント・評価(リスク/ES)の定義(GAS版 loadUiConfig / uiConfig)。
 * ログイン直後に AppShell が読み始めておくので、日報ダイアログを開いたときにはたいてい読み込み済み。
 * 読み込み前・失敗時は data が undefined(GAS版も uiConfig = {} のまま動く)。
 */
export function useUiConfig() {
  return useQuery({
    queryKey: queryKeys.uiConfig,
    queryFn: ({ signal }) => systemApi.uiConfig(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
