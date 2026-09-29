/**
 * 日報AIのモデルの切り替え(API エラーのとき、次のモデルで試し直す順番)。
 * 順番: 設定のモデル → Gemini Flash 系(新しい版から) → Gemini Flash-Lite 系(新しい版から)。
 * 使えるモデルの一覧(ListModels)が読めないときは FALLBACK_* の既知の名前を使う。
 */

export type ReportModelFamily = 'flash' | 'flash_lite';

/** 一覧が読めないときの Flash 系(新しい順)。 */
export const FALLBACK_FLASH_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'] as const;
/** 一覧が読めないときの Flash-Lite 系(新しい順)。 */
export const FALLBACK_FLASH_LITE_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-flash-lite-latest',
] as const;

/** 1回の生成で試すモデルの上限(設定のモデルを含む)。 */
export const MAX_REPORT_MODEL_ATTEMPTS = 8;

/** 版つきの名前(gemini-2.5-flash / gemini-2.0-flash-lite-001)。preview・exp・画像/音声向けなどの派生は使わない。 */
const VERSIONED = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(?:-(\d{3}))?$/;
/** 常に最新を指す別名(gemini-flash-latest / gemini-flash-lite-latest)。 */
const LATEST_ALIAS = /^gemini-flash(-lite)?-latest$/;

interface ParsedModel {
  name: string;
  family: ReportModelFamily;
  /** 別名(-latest)は同じ系統の版つきの後ろに回す */
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
    return { name, family: alias[1] ? 'flash_lite' : 'flash', version: -1, revision: 0 };
  }
  return null;
}

/** 日報の切り替え先に使える名前か(Flash / Flash-Lite 系の版つき名か -latest の別名)。 */
export function reportModelFamilyOf(name: string): ReportModelFamily | null {
  return parseModel(name)?.family ?? null;
}

function sortedFamily(models: readonly string[], family: ReportModelFamily): string[] {
  return models
    .map(parseModel)
    .filter((m): m is ParsedModel => m !== null && m.family === family)
    .sort((a, b) => b.version - a.version || b.revision - a.revision || a.name.localeCompare(b.name))
    .map((m) => m.name);
}

/**
 * 試す順のモデル名。configured(テナント・.env の設定のモデル。API キーが無い実装は null → 空)を先頭に、
 * available(ListModels の名前。null = 読めなかった)のうち Flash 系、Flash-Lite 系を新しい順に続ける。
 * 重複は除き、MAX_REPORT_MODEL_ATTEMPTS で打ち切る。
 */
export function buildReportModelChain(
  configured: string | null,
  available: readonly string[] | null,
): string[] {
  if (!configured) return [];
  const source = available ?? [...FALLBACK_FLASH_MODELS, ...FALLBACK_FLASH_LITE_MODELS];
  const chain = [configured, ...sortedFamily(source, 'flash'), ...sortedFamily(source, 'flash_lite')];
  return [...new Set(chain)].slice(0, MAX_REPORT_MODEL_ATTEMPTS);
}
