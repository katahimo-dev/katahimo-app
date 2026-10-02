import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { randomBytes } from 'node:crypto';
import { resolveReportAiPort } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { AI_COMPARE_USAGE, checkAiCompareTenant, parseAiCompareArgs } from './aiCompare/args';
import { runAiCompareCommand } from './aiCompare/command';
import { resolveInputPath } from './cliArgs';
import { writePrivateFile } from './privateFile';

/**
 * 運用のモデル比較: 過去の保育日報の AI 生成と同じプロンプトをいくつかの Gemini のモデルに送り直し、答えを並べた
 * HTML を1つ書き出す(審査用のテナントで、どのモデルで足りるかを決める。doc/07 の運用手順)。
 * AI_COMPARE_TENANTS に書いたテナントだけを読む。DB は読むだけ(操作ログ `ai.compare.completed` を1行だけ書く)。
 *
 * 使い方: pnpm ai:compare -- <slug> --models <m1,m2[,…]> [--generation <id> …] [--latest <N>] [--since YYYY-MM-DD]
 *         [--runs <1-3>] [--rebuild] [--thinking-budget <N>] [--blind] [--out <path>] [--dry-run]
 */
async function main() {
  const parsed = parseAiCompareArgs();
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${AI_COMPARE_USAGE}`);
    process.exit(1);
  }
  const args = parsed.value;
  const allowList = process.env.AI_COMPARE_TENANTS;
  // DB につなぐ前に断る(本物のお客様のテナントは読まない)
  const refused = checkAiCompareTenant(args.slug, allowList);
  if (refused) {
    console.error(`[ai:compare] ${refused}`);
    process.exit(1);
  }
  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, db);
    const outcome = await runAiCompareCommand(
      {
        allowList,
        tenants: container.tenants,
        uow: container.uow,
        appLog: container.appLog,
        resolveReportAi: (tenantId) => resolveReportAiPort(container, tenantId),
        resolvePath: (path) => resolveInputPath(path),
        // テナントのデータを含むので、書き出したファイルは本人だけが読める権限にする(既にあるファイルへの上書きも)
        writeFile: (path, content) => writePrivateFile(path, content),
        now: () => new Date(),
        blindSeed: () => randomBytes(8).toString('hex'),
        log: (line) => console.log(line),
        warn: (line) => console.warn(line),
      },
      args,
    );
    if (outcome.status === 'refused') {
      console.error(`[ai:compare] ${outcome.message}`);
      process.exitCode = 1;
    } else if (outcome.status === 'completed' && outcome.failures > 0) {
      console.warn(
        `[ai:compare] ${outcome.calls}回のうち ${outcome.failures}回が失敗しました(HTML に理由があります)`,
      );
    }
  } finally {
    await closeDatabase(db);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
