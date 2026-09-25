import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
 * 画面が隠れている間(別のアプリを開いている等)は確かめない(通信量・電池を使わないように)。
 */
export function useDataVersionPolling() {
  const queryClient = useQueryClient();
  const [watcher] = useState(createVersionWatcher);
  const { data } = useQuery({
    queryKey: queryKeys.dataVersion,
    queryFn: ({ signal }) => systemApi.dataVersion(signal),
    refetchInterval: DATA_VERSION_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
  // 1回目に届いた版数は基準にするだけ。そのあと違う版数が届いたら読み直す
  const version = data?.dataVersion;
  useEffect(() => {
    if (version === undefined) return;
    if (watcher.observe(version) === 'changed') {
      showToast('新しい情報があります。最新にしています…', false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all });
    }
  }, [version, watcher, queryClient]);
}
