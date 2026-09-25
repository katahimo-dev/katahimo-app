import { type ChildProcess, spawn } from 'node:child_process';
import { REPO_ROOT } from './paths';

/**
 * 通し確認(e2e)用に API を用意する。apiUrl で API が応答すればそれを使い、応答しなければ
 * `pnpm --filter @katahimo/api start` を子プロセスで起動する(ポートは apiUrl のもの。DB は .env のまま)。
 */
export interface ApiServerHandle {
  close: () => Promise<void>;
}

async function isApiUp(apiUrl: string): Promise<boolean> {
  try {
    // 未ログインなので 401 が返れば動いている
    const res = await fetch(`${apiUrl}/api/auth/me`);
    return res.status === 401 || res.ok;
  } catch {
    return false;
  }
}

export async function ensureApiServer(apiUrl: string, timeoutMs = 60_000): Promise<ApiServerHandle> {
  const url = apiUrl.replace(/\/$/, '');
  if (await isApiUp(url)) return { close: async () => undefined };

  const port = new URL(url).port || '80';
  console.log(`[e2e] API(${url})が動いていないため起動します`);
  const child: ChildProcess = spawn('pnpm', ['--filter', '@katahimo/api', 'start'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const close = async () => {
    if (child.exitCode !== null || child.pid === undefined) return;
    // pnpm → tsx → node とプロセスがつながるため、グループごと止める
    process.kill(-child.pid, 'SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API が起動できませんでした(終了コード ${child.exitCode})`);
    if (await isApiUp(url)) return { close };
    await new Promise((r) => setTimeout(r, 500));
  }
  await close();
  throw new Error(`API(${url})が ${timeoutMs / 1000} 秒たっても応答しません`);
}
