import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

/**
 * モノレポのルート .env を読み込む(packages/api/src/loadDotenv.tsと同じ挙動)。
 * ワーカーはAPIサーバーと同じ .env(DATABASE_URL・LOCAL_DEV_KEK等)を共有する想定。
 */
export function loadDotenv(startDir: string = process.cwd()): void {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  config();
}
