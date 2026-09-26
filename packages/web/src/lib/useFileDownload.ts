import { useCallback, useRef, useState } from 'react';
import type { DownloadedFile } from '../api/client';
import { showErrorToast, showToast } from '../ui/toast';
import { saveBlobAsFile } from './saveFile';

/**
 * ファイルの保存(CSV・Excel)。`api.download()` で受けてから `saveBlobAsFile` で保存する(`<a href download>` だと、断られた
 * ときの理由の JSON がファイルとして保存されてしまうため)。保存している間は同じボタンを押しても2回目は送らない
 * (`busy` はいま保存しているもの)。失敗はサーバーの理由を赤いお知らせで出す(回数の上限は「あと約N分」つき)。
 */
export function useFileDownload<K extends string>() {
  const [busy, setBusy] = useState<K | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (kind: K, download: () => Promise<DownloadedFile>, successMessage: string): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(kind);
      try {
        const file = await download();
        saveBlobAsFile(file.blob, file.filename);
        showToast(successMessage);
      } catch (error) {
        showErrorToast(error);
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [],
  );

  return { busy, run };
}
