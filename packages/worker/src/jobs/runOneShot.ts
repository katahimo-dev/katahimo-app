import { getDatabase } from '@katahimo/db';
import { createWorkerContainer, type WorkerContainer } from '../container';
import { loadWorkerEnv, type WorkerEnv } from '../env';
import { loadDotenv } from '../loadDotenv';
import { logJson } from './log';

/**
 * Cloud Run Jobs 等から1回だけ実行するジョブの共通の起動処理。
 * job が ok=false を返すか例外を投げたら終了コード1で終わる(Cloud Run Jobs が失敗として扱い再試行できる)。
 */
export function runOneShot(
  name: string,
  job: (container: WorkerContainer, env: WorkerEnv) => Promise<{ ok: boolean }>,
): void {
  loadDotenv();
  const env = loadWorkerEnv();
  const container = createWorkerContainer(env, getDatabase());
  const startedAt = Date.now();
  logJson('INFO', `${name} を開始します`);
  job(container, env)
    .then(({ ok }) => {
      logJson(ok ? 'INFO' : 'ERROR', `${name} を終了しました`, { ok, elapsedMs: Date.now() - startedAt });
      process.exit(ok ? 0 : 1);
    })
    .catch((error) => {
      logJson('ERROR', `${name} が異常終了しました`, { error: String(error) });
      process.exit(1);
    });
}
