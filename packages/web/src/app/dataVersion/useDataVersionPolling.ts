import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '../../api/queryKeys';
import { systemApi } from '../../api/system';
import { showToast } from '../../ui/toast';
import { createVersionWatcher } from './versionWatcher';

/** GAS版と同じく1分ごと。 */
export const DATA_VERSION_POLL_INTERVAL_MS = 60_000;

/**
 * 顧客データの版数を1分ごとに確かめ、新しい顧客CSVが取り込まれていたら顧客データを読み直す
 * (GAS版 startVersionPolling / checkForUpdates)。
 *
 * GAS版は画面を開いたときに顧客CSVの取り込み(checkAndImportLatestCsv)も行っていたが、
 * 新しいサーバーは取り込みを定期実行するため、画面側は版数を見るだけにしている。
 * 失敗(電波が悪い等)はGAS版と同じく何も表示しない(次の回にまた確かめる)。
 */
export function useDataVersionPolling() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const watcher = createVersionWatcher();
    let cancelled = false;

    const check = async () => {
      try {
        const { dataVersion } = await systemApi.dataVersion();
        if (cancelled) return;
        if (watcher.observe(dataVersion) === 'changed') {
          showToast('新しい情報があります。最新にしています…', false);
          await queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
        }
      } catch {
        // 次の回に確かめ直す
      }
    };

    void check();
    const timer = setInterval(check, DATA_VERSION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [queryClient]);
}
