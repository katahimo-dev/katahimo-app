import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

/** モノレポのルート .env を、パッケージディレクトリから上位を辿って読み込む(既存のOS環境変数は上書きしない)。 */
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
