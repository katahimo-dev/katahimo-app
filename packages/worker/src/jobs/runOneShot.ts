import { closeDatabase, createDatabase } from '@katahimo/db';
import { createWorkerContainer, type WorkerContainer } from '../container';
import { loadWorkerEnv, type WorkerEnv } from '../env';
import { loadDotenv } from '../loadDotenv';
import { logJson } from './log';
import { StopSignal } from './stopSignal';

/**
 * Cloud Run Jobs 等から1回だけ実行するジョブの共通の起動処理。job が ok=false を返す・例外を投げる・
 * JOB_TIMEOUT_MS を超えたら終了コード1(Cloud Run Jobs が失敗として扱い再試行できる)。停止の合図が来たら
 * job に伝え(区切りで止まる)、WORKER_SHUTDOWN_TIMEOUT_MS 待っても終わらなければ強制終了する。
 * 終わるときは DB の接続プール(鍵の読み込み専用のプールも)を閉じる。
 */
export function runOneShot(
  name: string,
  job: (container: WorkerContainer, env: WorkerEnv, stop: StopSignal) => Promise<{ ok: boolean }>,
): void {
  loadDotenv();
  const env = loadWorkerEnv();
  const db = createDatabase(env.WORKER_DATABASE_URL);
  // テナントの鍵の読み込み専用のプール(api の server.ts と同じ)
  const keyDb = createDatabase(env.WORKER_DATABASE_URL, { max: 1 });
  const container = createWorkerContainer(env, db, keyDb);
  const stop = new StopSignal().listen((signal) => {
    logJson('WARNING', `${name}: ${signal} を受け取りました。区切りで止めます`);
    setTimeout(() => {
      logJson('ERROR', `${name}: 停止が時間内に終わらないため強制終了します`);
      process.exit(1);
    }, env.WORKER_SHUTDOWN_TIMEOUT_MS).unref();
  });
  const hardTimeout = setTimeout(() => {
    logJson('ERROR', `${name}: 上限時間(${env.JOB_TIMEOUT_MS}ms)を超えたため終了します`);
    process.exit(1);
  }, env.JOB_TIMEOUT_MS);
  hardTimeout.unref();

  const startedAt = Date.now();
  logJson('INFO', `${name} を開始します`);
  const finish = async (code: number) => {
    await Promise.all([closeDatabase(db), closeDatabase(keyDb)]).catch(() => undefined);
    process.exit(code);
  };
  job(container, env, stop)
    .then(({ ok }) => {
      logJson(ok ? 'INFO' : 'ERROR', `${name} を終了しました`, { ok, elapsedMs: Date.now() - startedAt });
      return finish(ok ? 0 : 1);
    })
    .catch((error: unknown) => {
      logJson('ERROR', `${name} が異常終了しました`, { error: String(error) });
      return finish(1);
    });
}
