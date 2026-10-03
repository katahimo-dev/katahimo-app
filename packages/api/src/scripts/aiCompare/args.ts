import { AI_COMPARE_LIMITS } from '@katahimo/core/usecases';
import { cliArgs, takeOption, takeRepeatedOption } from '../cliArgs';

/**
 * 運用のモデル比較 `pnpm ai:compare` の引数(doc/07 の運用手順)。
 */

export const AI_COMPARE_USAGE = [
  '使い方: pnpm ai:compare -- <slug> --models <モデル1,モデル2[,…]> [--generation <生成のID> …] [--latest <件数>] [--since YYYY-MM-DD]',
  '                          [--runs <1〜3>] [--rebuild] [--thinking-budget <トークン数>] [--blind] [--out <パス>] [--dry-run]',
  `  対象は AI_COMPARE_TENANTS(カンマ区切りの slug)に書いたテナントだけ。モデルは最大${AI_COMPARE_LIMITS.maxModels}つ、件数は最大${AI_COMPARE_LIMITS.maxCases}件(--latest の既定 ${AI_COMPARE_LIMITS.defaultLatest})、`,
  `  Gemini を呼ぶ回数(件数 × モデル × 回数)は最大${AI_COMPARE_LIMITS.maxCalls}回`,
  '  --rebuild は記録のメモと今のプロンプト・マスター・家庭の★から組み立て直したプロンプトを送る(既定は当時のプロンプトのまま)',
  '  --blind はモデル名を A・B・C… に隠す(対応は HTML の末尾)。--dry-run は対象と回数を表示するだけ(Gemini を呼ばず、何も書かない)',
].join('\n');

export interface AiCompareArgs {
  slug: string;
  models: string[];
  generationIds: string[];
  latest: number;
  since: string | undefined;
  runs: number;
  rebuild: boolean;
  thinkingBudget: number | undefined;
  blind: boolean;
  out: string | undefined;
  dryRun: boolean;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** モデル名(URL のパスに入れるので、英数字・点・ハイフンだけ)。 */
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Gemini の thinkingBudget の範囲(-1 = モデルに任せる、0 = 思考しない)。 */
const THINKING_BUDGET_MIN = -1;
const THINKING_BUDGET_MAX = 32_768;

const FLAGS: readonly string[] = ['--rebuild', '--blind', '--dry-run'];

function integerOf(value: string | undefined): number | null {
  return value !== undefined && /^-?\d+$/.test(value) ? Number(value) : null;
}

function isRealDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** 整数のオプション(範囲外・整数でなければ null)。 */
function rangedInteger(value: string, min: number, max: number): number | null {
  const n = integerOf(value);
  return n === null || n < min || n > max ? null : n;
}

export function parseAiCompareArgs(argv: readonly string[] = process.argv): Parsed<AiCompareArgs> {
  const all = cliArgs(argv);
  const flags = new Set(all.filter((a) => FLAGS.includes(a)));
  const generation = takeRepeatedOption(
    all.filter((a) => !FLAGS.includes(a)),
    '--generation',
  );
  let rest = generation.rest;
  const take = (name: string) => {
    const taken = takeOption(rest, name);
    rest = taken.rest;
    return taken.value;
  };
  const modelsText = take('--models');
  const latestText = take('--latest');
  const since = take('--since');
  const runsText = take('--runs');
  const thinkingText = take('--thinking-budget');
  const out = take('--out');
  const [slug, ...others] = rest;
  if (!slug || slug.startsWith('--')) return { ok: false, message: 'テナントの slug を指定してください' };
  if (others.length > 0) return { ok: false, message: `知らない引数です: ${others.join(' ')}` };

  const models = (modelsText ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m !== '');
  if (models.length === 0) {
    return { ok: false, message: '--models に比べるモデルをカンマ区切りで指定してください' };
  }
  if (models.length > AI_COMPARE_LIMITS.maxModels) {
    return { ok: false, message: `--models は最大${AI_COMPARE_LIMITS.maxModels}つです` };
  }
  const badModel = models.find((m) => !MODEL_NAME.test(m));
  if (badModel !== undefined) return { ok: false, message: `モデル名が正しくありません: ${badModel}` };
  if (new Set(models).size !== models.length) {
    return { ok: false, message: '--models に同じモデルが2回あります' };
  }

  const generationIds: string[] = [];
  for (const id of generation.values) {
    if (id === undefined || !UUID.test(id)) {
      return { ok: false, message: `--generation には生成の ID(UUID)を指定してください: ${id ?? '(なし)'}` };
    }
    const normalized = id.toLowerCase();
    if (!generationIds.includes(normalized)) generationIds.push(normalized);
  }
  if (generationIds.length > AI_COMPARE_LIMITS.maxCases) {
    return { ok: false, message: `--generation は最大${AI_COMPARE_LIMITS.maxCases}件です` };
  }
  if (generationIds.length > 0 && (latestText !== undefined || since !== undefined)) {
    return { ok: false, message: '--generation と --latest・--since は一緒に使えません' };
  }

  let latest: number = AI_COMPARE_LIMITS.defaultLatest;
  if (latestText !== undefined) {
    const n = rangedInteger(latestText, 1, AI_COMPARE_LIMITS.maxCases);
    if (n === null) return { ok: false, message: `--latest は 1〜${AI_COMPARE_LIMITS.maxCases} の整数です` };
    latest = n;
  }
  if (since !== undefined && !isRealDate(since)) {
    return { ok: false, message: '--since は YYYY-MM-DD の日付です' };
  }

  let runs = 1;
  if (runsText !== undefined) {
    const n = rangedInteger(runsText, 1, AI_COMPARE_LIMITS.maxRuns);
    if (n === null) return { ok: false, message: `--runs は 1〜${AI_COMPARE_LIMITS.maxRuns} の整数です` };
    runs = n;
  }

  let thinkingBudget: number | undefined;
  if (thinkingText !== undefined) {
    const n = rangedInteger(thinkingText, THINKING_BUDGET_MIN, THINKING_BUDGET_MAX);
    if (n === null) {
      return {
        ok: false,
        message: `--thinking-budget は ${THINKING_BUDGET_MIN}〜${THINKING_BUDGET_MAX} の整数です(0 = 思考しない、-1 = モデルに任せる)`,
      };
    }
    thinkingBudget = n;
  }
  if (out !== undefined && (out === '' || out.startsWith('--'))) {
    return { ok: false, message: '--out には書き出すファイルのパスを指定してください' };
  }

  return {
    ok: true,
    value: {
      slug,
      models,
      generationIds,
      latest,
      since,
      runs,
      rebuild: flags.has('--rebuild'),
      thinkingBudget,
      blind: flags.has('--blind'),
      out,
      dryRun: flags.has('--dry-run'),
    },
  };
}

/** 末尾の `*` で前方一致を書くときの、`*` の前(接頭辞)の最小の長さ(`a*` のような広すぎる指定を断る)。 */
const MIN_WILDCARD_PREFIX_LENGTH = 3;

/** AI_COMPARE_TENANTS の1つの書き方(完全一致の slug か、`<接頭辞>*` の前方一致)に slug が合うか。書き方が正しくなければ false。 */
function matchesAllowedTenant(entry: string, slug: string): boolean {
  if (!entry.endsWith('*')) return entry === slug;
  const prefix = entry.slice(0, -1);
  return (
    prefix.length >= MIN_WILDCARD_PREFIX_LENGTH &&
    /^[a-z0-9][a-z0-9-]*$/.test(prefix) &&
    slug.startsWith(prefix)
  );
}

/**
 * 比べてよいテナントか(AI_COMPARE_TENANTS に書いた slug だけ。末尾の `*` で前方一致も書ける: `public-demo-*` は
 * 毎晩の作り直しが残した `public-demo-YYYYMMDD` を全て含む。接頭辞は3文字以上の英小文字・数字・`-` だけで、`*` だけ・
 * 途中の `*` は無効)。本物のお客様のテナントの記録を読まないための確かめで、未設定なら全て断る。
 * 断るときは日本語の理由、よければ null。
 */
export function checkAiCompareTenant(slug: string, allowList: string | undefined): string | null {
  const allowed = (allowList ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (allowed.some((entry) => matchesAllowedTenant(entry, slug))) return null;
  return allowed.length === 0
    ? 'AI_COMPARE_TENANTS が設定されていません。比べてよいテナント(審査用の架空のデータのテナント)の slug をカンマ区切りで設定してください(末尾の * で前方一致も書けます)'
    : `テナント ${slug} は AI_COMPARE_TENANTS に無いため比べられません(本物のお客様のテナントの記録は読みません)`;
}
