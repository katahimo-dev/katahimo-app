import { cliArgs, takeOption, takeRepeatedOption } from './cliArgs';

/**
 * GAS版のスプレッドシートからの移行の取込(`pnpm import:legacy-reports` / `pnpm import:legacy-receipts`)の引数。
 * スプレッドシートの ID は GAS版の Config.js(SPREADSHEET_ID / IMAGE_LOG_SS_ID)の値を渡す(コードには持たない)。
 */

export const LEGACY_REPORTS_USAGE = [
  '使い方: pnpm import:legacy-reports -- <slug> --spreadsheet <スプレッドシートID> [--daily-sheet <シート名>] [--accident-sheet <シート名>] [--dry-run]',
  '  スプレッドシートID は GAS版の Config.js の SPREADSHEET_ID(「顧客DB 日報 事故報告」)。シート名の既定は「日報」「事故報告」',
].join('\n');

export const LEGACY_RECEIPTS_USAGE = [
  '使い方: pnpm import:legacy-receipts -- <slug> --spreadsheet <スプレッドシートID> (--month YYYY-MM ... | --from YYYY-MM --to YYYY-MM) [--sheet <シート名>] [--dry-run]',
  '  スプレッドシートID は GAS版の Config.js の IMAGE_LOG_SS_ID(「領収書一覧」)。シートの既定は先頭のシート。--month は何回でも指定できる',
].join('\n');

export interface LegacyReportsArgs {
  slug: string;
  spreadsheetId: string;
  dailySheetName: string | undefined;
  accidentSheetName: string | undefined;
  dryRun: boolean;
}

export interface LegacyReceiptsArgs {
  slug: string;
  spreadsheetId: string;
  sheetName: string | undefined;
  /** 取り込む月('YYYY-MM'。古い順・重複なし)。 */
  months: string[];
  dryRun: boolean;
}

/** 1回に指定できる月の数の上限(誤って何年分も読まないように)。 */
export const MAX_LEGACY_RECEIPT_MONTHS = 36;

const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,}$/;
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** 共通: slug・--spreadsheet・--dry-run と、知らない引数が無いこと。 */
function parseCommon(
  args: string[],
): Parsed<{ slug: string; spreadsheetId: string; dryRun: boolean; rest: string[] }> {
  const dryRun = args.includes('--dry-run');
  const { rest, value: spreadsheetId } = takeOption(
    args.filter((a) => a !== '--dry-run'),
    '--spreadsheet',
  );
  const [slug, ...others] = rest;
  if (!slug || slug.startsWith('--')) return { ok: false, message: 'テナントの slug を指定してください' };
  if (!spreadsheetId || !SPREADSHEET_ID.test(spreadsheetId)) {
    return {
      ok: false,
      message: '--spreadsheet にスプレッドシートの ID(URL の /d/ の後ろ)を指定してください',
    };
  }
  return { ok: true, value: { slug, spreadsheetId, dryRun, rest: others } };
}

function rejectRest(rest: string[]): string | null {
  return rest.length > 0 ? `知らない引数です: ${rest.join(' ')}` : null;
}

export function parseLegacyReportsArgs(argv: readonly string[] = process.argv): Parsed<LegacyReportsArgs> {
  const common = parseCommon(cliArgs(argv));
  if (!common.ok) return common;
  const daily = takeOption(common.value.rest, '--daily-sheet');
  const accident = takeOption(daily.rest, '--accident-sheet');
  const unknown = rejectRest(accident.rest);
  if (unknown) return { ok: false, message: unknown };
  for (const [name, value] of [
    ['--daily-sheet', daily.value],
    ['--accident-sheet', accident.value],
  ] as const) {
    if (common.value.rest.includes(name) && !value?.trim()) {
      return { ok: false, message: `${name} にシート名を指定してください` };
    }
  }
  const { slug, spreadsheetId, dryRun } = common.value;
  return {
    ok: true,
    value: { slug, spreadsheetId, dryRun, dailySheetName: daily.value, accidentSheetName: accident.value },
  };
}

/** 'YYYY-MM' を年と月の通し番号にする(読めなければ null)。 */
function monthIndexOf(value: string | undefined): number | null {
  const match = YEAR_MONTH.exec(value ?? '');
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
}

const yearMonthOfIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

export function parseLegacyReceiptsArgs(argv: readonly string[] = process.argv): Parsed<LegacyReceiptsArgs> {
  const common = parseCommon(cliArgs(argv));
  if (!common.ok) return common;
  const months = takeRepeatedOption(common.value.rest, '--month');
  const from = takeOption(months.rest, '--from');
  const to = takeOption(from.rest, '--to');
  const sheet = takeOption(to.rest, '--sheet');
  const unknown = rejectRest(sheet.rest);
  if (unknown) return { ok: false, message: unknown };
  if (to.rest.includes('--sheet') && !sheet.value?.trim()) {
    return { ok: false, message: '--sheet にシート名を指定してください' };
  }
  const indexes = new Set<number>();
  for (const value of months.values) {
    const index = monthIndexOf(value);
    if (index === null)
      return { ok: false, message: `--month は YYYY-MM で指定してください: ${value ?? ''}` };
    indexes.add(index);
  }
  const hasRange = from.value !== undefined || to.value !== undefined || months.rest.includes('--from');
  if (hasRange) {
    const start = monthIndexOf(from.value);
    const end = monthIndexOf(to.value);
    if (start === null || end === null) {
      return { ok: false, message: '--from と --to は両方を YYYY-MM で指定してください' };
    }
    if (start > end) return { ok: false, message: '--from は --to より前の月にしてください' };
    for (let i = start; i <= end && indexes.size <= MAX_LEGACY_RECEIPT_MONTHS; i++) indexes.add(i);
  }
  if (indexes.size === 0) {
    return { ok: false, message: '取り込む月を --month YYYY-MM か --from/--to で指定してください' };
  }
  if (indexes.size > MAX_LEGACY_RECEIPT_MONTHS) {
    return { ok: false, message: `取り込む月は${MAX_LEGACY_RECEIPT_MONTHS}か月までです` };
  }
  const { slug, spreadsheetId, dryRun } = common.value;
  return {
    ok: true,
    value: {
      slug,
      spreadsheetId,
      dryRun,
      sheetName: sheet.value,
      months: [...indexes].sort((a, b) => a - b).map(yearMonthOfIndex),
    },
  };
}
