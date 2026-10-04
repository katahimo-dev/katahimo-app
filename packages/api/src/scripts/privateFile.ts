import { open } from 'node:fs/promises';

/**
 * 本人だけが読める(0600)ファイルに書く。`writeFile` の `mode` は新しく作るときにしか効かないため、既にあるファイル
 * (前に 0644 で作った等)に上書きすると、テナントのデータが他のユーザーに読める権限のまま残る。開いた後、中身を書く前に
 * 権限を 0600 に直す(書いた中身が一瞬でも広い権限で見えないように)。
 */
export async function writePrivateFile(path: string, content: string): Promise<void> {
  const handle = await open(path, 'w', 0o600);
  try {
    await handle.chmod(0o600).catch((error: NodeJS.ErrnoException) => {
      // 権限の概念が無いファイルシステム(運用スクリプトのジョブの /ops = Cloud Storage のバケット。読めるのは
      // バケットの IAM で決まる)は権限を変えられない。それ以外の失敗はこれまでどおり止める
      if (error.code !== 'ENOTSUP' && error.code !== 'ENOSYS') throw error;
    });
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}
