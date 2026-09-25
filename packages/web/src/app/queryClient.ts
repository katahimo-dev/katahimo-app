import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 現場はモバイル回線のため、画面に戻るたびの再取得はしない(GAS版も読み直しはボタンか版数の変化だけ)
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000,
      },
    },
  });
}
