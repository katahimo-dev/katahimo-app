/**
 * 日報・事故報告・領収書の読み取りで使う Gemini のモデルの順番(API エラーのとき、次のモデルで試し直す順番)。
 * モデルは自動で選ぶ(管理者が選ぶ設定は無い)。
 * - 日報・事故報告: Flash 系 → Flash-Lite 系(系統ごとに MAX_REPORT_MODELS_PER_FAMILY まで、合わせて MAX_REPORT_MODEL_ATTEMPTS)
 * - 領収書の読み取り: Flash-Lite 系だけ(MAX_OCR_MODEL_ATTEMPTS まで)
 * 系統の中の順番: `-latest` の別名が先頭、次に版つきの名前を新しい版から(同じ版は末尾の 3桁が無い名前 → 3桁の大きい順)。
 * 使えるモデルの一覧(ListModels)が読めないとき・一覧に系統の名前が無いときは FALLBACK_* の既知の名前を使う。
 */

export type ReportModelFamily = 'flash' | 'flash_lite';

/** 一覧が読めないときの Flash 系(試す順)。 */
export const FALLBACK_FLASH_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'] as const;
/** 一覧が読めないときの Flash-Lite 系(試す順)。 */
export const FALLBACK_FLASH_LITE_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
] as const;

/** 日報・事故報告の1回の生成で試すモデルの上限。 */
export const MAX_REPORT_MODEL_ATTEMPTS = 8;
/** 日報・事故報告で系統ごとに試すモデルの上限(Flash 系の一覧が長くても Flash-Lite 系を必ず試すように)。 */
export const MAX_REPORT_MODELS_PER_FAMILY = 4;
/** 領収書の読み取り1回で試すモデルの上限(サーバーの中で順に試す)。 */
export const MAX_OCR_MODEL_ATTEMPTS = 3;

/** 版つきの名前(gemini-2.5-flash / gemini-2.0-flash-lite-001)。preview・exp・画像/音声向けなどの派生は使わない。 */
const VERSIONED = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(?:-(\d{3}))?$/;
/** 常に最新を指す別名(gemini-flash-latest / gemini-flash-lite-latest)。 */
const LATEST_ALIAS = /^gemini-flash(-lite)?-latest$/;

interface ParsedModel {
  name: string;
  family: ReportModelFamily;
  /** 別名(-latest)は系統の先頭にする(Infinity) */
  version: number;
  /** 末尾の 3桁(-001)。無い名前(最新版の別名)を先にする */
  revision: number;
}

function parseModel(name: string): ParsedModel | null {
  const versioned = VERSIONED.exec(name);
  if (versioned) {
    return {
      name,
      family: versioned[2] ? 'flash_lite' : 'flash',
      version: Number(versioned[1]),
      revision: versioned[3] ? Number(versioned[3]) : Number.POSITIVE_INFINITY,
    };
  }
  const alias = LATEST_ALIAS.exec(name);
  if (alias) {
    return {
      name,
      family: alias[1] ? 'flash_lite' : 'flash',
      version: Number.POSITIVE_INFINITY,
      revision: Number.POSITIVE_INFINITY,
    };
  }
  return null;
}

/** 生成に使える名前か(Flash / Flash-Lite 系の版つき名か -latest の別名)。 */
export function reportModelFamilyOf(name: string): ReportModelFamily | null {
  return parseModel(name)?.family ?? null;
}

const compareDesc = (a: number, b: number) => (a === b ? 0 : a > b ? -1 : 1);

function sortedFamily(models: readonly string[], family: ReportModelFamily): string[] {
  return models
    .map(parseModel)
    .filter((m): m is ParsedModel => m !== null && m.family === family)
    .sort(
      (a, b) =>
        compareDesc(a.version, b.version) ||
        compareDesc(a.revision, b.revision) ||
        a.name.localeCompare(b.name),
    )
    .map((m) => m.name);
}

const FALLBACK_BY_FAMILY: Record<ReportModelFamily, readonly string[]> = {
  flash: FALLBACK_FLASH_MODELS,
  flash_lite: FALLBACK_FLASH_LITE_MODELS,
};

/**
 * 系統の試す順。available(ListModels の名前)にその系統の名前が1つも無いとき(null = 読めなかったときも)は、
 * その系統の既知の名前(FALLBACK_*)を使う(一覧の形が変わっても試すモデルが無くならないように。GAS版と同じ)。
 */
function familyChain(available: readonly string[] | null, family: ReportModelFamily): string[] {
  const listed = available ? sortedFamily(available, family) : [];
  return listed.length > 0 ? listed : [...FALLBACK_BY_FAMILY[family]];
}

/**
 * 日報・事故報告で試す順のモデル名。available(ListModels の名前。null = 読めなかった)のうち Flash 系、Flash-Lite 系
 * の順(系統の名前が無ければその系統の既知の名前)。系統ごとに MAX_REPORT_MODELS_PER_FAMILY 件で打ち切る(合わせて
 * MAX_REPORT_MODEL_ATTEMPTS 件まで)。
 * API キーが無いとき(試すモデルが無い)の判定は呼び出し側(ReportAiPort.hasApiKey)で行う。
 */
export function buildReportModelChain(available: readonly string[] | null): string[] {
  const chain = [
    ...familyChain(available, 'flash').slice(0, MAX_REPORT_MODELS_PER_FAMILY),
    ...familyChain(available, 'flash_lite').slice(0, MAX_REPORT_MODELS_PER_FAMILY),
  ];
  return [...new Set(chain)].slice(0, MAX_REPORT_MODEL_ATTEMPTS);
}

/** 領収書の読み取りで試す順のモデル名(Flash-Lite 系だけ。MAX_OCR_MODEL_ATTEMPTS で打ち切る)。 */
export function buildOcrModelChain(available: readonly string[] | null): string[] {
  return [...new Set(familyChain(available, 'flash_lite'))].slice(0, MAX_OCR_MODEL_ATTEMPTS);
}
