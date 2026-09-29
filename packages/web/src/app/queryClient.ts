import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';

/**
 * 読み込みに失敗したとき、1回だけ読み直す。ただしサーバーが理由を付けて断った失敗(4xx: 権限が無い・
 * 見つからない・入力が違う等)は、くり返しても結果が変わらないので読み直さない。
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 現場はモバイル回線のため、画面に戻るたびの再取得はしない(GAS版も読み直しはボタンか版数の変化だけ)。
        // 予定タブのルートつき予定だけは例外(担当変更をすぐ出すため戻るたびに読み直す。useScheduleView)
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
        staleTime: 60_000,
      },
    },
  });
}
