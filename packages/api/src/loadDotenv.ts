import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

/**
 * モノレポのルート .env を読み込む。
 * 各パッケージ(packages/api 等)から起動しても、上位ディレクトリを辿って .env を見つける。
 * 環境変数が既にOS/コンテナ側で設定されている場合(本番)はそちらを優先し、上書きしない。
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
  // .env が無くてもOS環境変数だけで動く場合があるので、ここでは失敗させない
  config();
}
