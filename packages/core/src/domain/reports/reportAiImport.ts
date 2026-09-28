import {
  AGE_MONTHS_MAX,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
  type ReportAgeBandInput,
  type ReportAiImportIssue,
  type ReportAiMasterKind,
  type ReportEducationLevelInput,
  type ReportKeywordInput,
  type ReportPhraseInput,
  type ReportPsiLevelInput,
  type ReportStanceRuleInput,
  reportAgeBandInputSchema,
  reportEducationLevelInputSchema,
  reportKeywordInputSchema,
  reportPhraseInputSchema,
  reportPsiLevelInputSchema,
  reportStanceRuleInputSchema,
  type TermNamePolicy,
} from '@katahimo/shared';

/**
 * 日報AIの調整のマスター(お客様の「日報キーワード表現マスター」xlsx。プロンプト変更案の「参照ブロック_キーワード
 * 貼付用」シートの形も)を読む純関数。xlsx の読み書きそのもの(exceljs)は API 側で、ここはシートのセルの表
 * (行 × 列の値)だけを受け取る。
 *
 * - シートの種類はシート名ではなく見出しの行で決める(見出しの行は上から10行までを探す。1行目が注記の結合セルの
 *   シートがあるため)。見出しは NFKC・小文字にし、括弧の中・空白・記号(★ ◎ ✕ ・ _ / など)を落として比べる
 *   (「PSI下限(この値以上で使用可)」「PSI下限」は同じ列)。どの種類にも当てはまらないシート(使い方・フロー図)は
 *   読まずに知らせる。
 * - 値の書き方のゆれを読む: 「4-5」「★3〜★5」「5」(★の範囲。Excel が日付に変えた 4/5 も)、「1〜4」「全PSI可」
 *   (PSI の範囲)、「0〜1個」「1〜2個（詰め込みNG）」(教育語の数)、「K11 K12」(キーワードID の並び)、
 *   「◎使う」「✕避ける」(表現の区分)、「0〜6ヶ月」「3-6歳(36-84)」(月齢)。
 * - 1行ずつ契約(@katahimo/shared の *InputSchema)で確かめ、通らない行は誤り(シート名・行番号・理由)にする。
 *   誤りが1つでもあれば取込は反映しない(直してから取り込み直す)。同じシートに同じキーの行が2つあれば誤り、
 *   別のシートにあれば後のシートの行を使って知らせる。
 */

/**
 * 値を読めないセル(エラーの値「#N/A」など・計算結果の残っていない式・知らない形の値)。空欄(null)とは分ける:
 * スタッフの取込は空欄を値の削除として扱うため、読めないセルを空欄にすると黙って値が消える(スタッフの取込は誤りにする)。
 * 日報AIの調整の取込は空欄と同じに扱う(cellText は '')。
 */
export interface UnreadableCell {
  readonly unreadable: true;
}
export const UNREADABLE_CELL: UnreadableCell = Object.freeze({ unreadable: true as const });

export type ImportCell = string | number | boolean | Date | UnreadableCell | null | undefined;

export function isUnreadableCell(cell: ImportCell): cell is UnreadableCell {
  return typeof cell === 'object' && cell !== null && !(cell instanceof Date) && cell.unreadable === true;
}

export interface ReportAiImportSheet {
  name: string;
  /** 1行目から順の行。各行は A 列から順のセルの値(結合セルは左上だけに値がある)。 */
  rows: readonly (readonly ImportCell[])[];
}

export interface ParsedReportAiImport {
  keywords: ReportKeywordInput[];
  ageBands: ReportAgeBandInput[];
  educationLevels: ReportEducationLevelInput[];
  psiLevels: ReportPsiLevelInput[];
  phrases: ReportPhraseInput[];
  stanceRules: ReportStanceRuleInput[];
  /** 種類ごとの、読めた行の数(誤りの行を含む)。 */
  rowCounts: Record<ReportAiMasterKind, number>;
  errors: ReportAiImportIssue[];
  warnings: ReportAiImportIssue[];
}

/** 見出しを比べる形にする。 */
export function normalizeHeader(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s★☆◎○◯●✕×✗✘・_\-/:「」『』【】[\]〔〕]/g, '');
}

/**
 * セルの値を文字にする(数は整数ならそのまま、真偽は ○×、日付は「月-日」= Excel が「4-5」を日付にした場合)。
 * 読めないセルは空欄と同じ ''(空欄と分けたいときは先に isUnreadableCell で見る)。
 */
export function cellText(cell: ImportCell): string {
  if (cell === null || cell === undefined || isUnreadableCell(cell)) return '';
  if (cell instanceof Date) return `${cell.getUTCMonth() + 1}-${cell.getUTCDate()}`;
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : String(cell);
  if (typeof cell === 'boolean') return cell ? '○' : '×';
  return cell.replace(/\r\n?/g, '\n').trim();
}

const RANGE_SEP = '[-~〜～−–—ー]';

/** 整数(全角・「★3」・「★★★」も)。読めなければ null。 */
export function parseInteger(cell: ImportCell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? Math.round(cell) : null;
  const text = cellText(cell).normalize('NFKC').replace(/\s/g, '');
  if (/^★+$/.test(text)) return text.length;
  const m = /^★?(\d+)(?:\.0+)?(?:個|か月|ヶ月|ヵ月|カ月)?$/.exec(text);
  return m ? Number(m[1]) : null;
}

/** 範囲「a-b」「a〜b」「a」「a以上」「a以下」。all はすべてを表す語(「全PSI可」など)。 */
function parseRange(
  cell: ImportCell,
  bounds: { min: number; max: number },
  options: { allWords?: RegExp } = {},
): [number, number] | null {
  const text = cellText(cell)
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, '')
    .replace(/[★\s]|個/g, '');
  if (!text) return null;
  if (options.allWords?.test(text)) return [bounds.min, bounds.max];
  let m = new RegExp(`^(\\d+)${RANGE_SEP}+(\\d+)$`).exec(text);
  if (m) return [Number(m[1]), Number(m[2])];
  m = /^(\d+)以上$/.exec(text);
  if (m) return [Number(m[1]), bounds.max];
  m = /^(\d+)(?:以下|まで)$/.exec(text);
  if (m) return [bounds.min, Number(m[1])];
  m = /^(\d+)$/.exec(text);
  if (m) return [Number(m[1]), Number(m[1])];
  return null;
}

/** 教育思考レベル適用★(「4-5」「★3〜★5」「5」)。 */
export function parseLevelRange(cell: ImportCell): [number, number] | null {
  return parseRange(cell, { min: REPORT_LEVEL_MIN, max: REPORT_LEVEL_MAX }, { allWords: /^(全|すべて)/ });
}

/** 推奨PSI・適用範囲(「1〜4」「全PSI可」「全日報で不使用(PSI問わず)」)。 */
export function parsePsiRange(cell: ImportCell): [number, number] | null {
  const raw = cellText(cell).normalize('NFKC');
  if (/全|問わず|すべて/.test(raw)) return [REPORT_LEVEL_MIN, REPORT_LEVEL_MAX];
  return parseRange(cell, { min: REPORT_LEVEL_MIN, max: REPORT_LEVEL_MAX });
}

/** 1通あたり教育語(「0個」「0〜1個」「1〜2個（詰め込みNG）」)。 */
export function parseCountRange(cell: ImportCell): [number, number] | null {
  return parseRange(cell, { min: 0, max: 9 });
}

const MONTH_UNIT = '(?:ヶ月|か月|ヵ月|カ月|ケ月|箇月|ヶ月齢|月齢|月)';

/**
 * 月齢の範囲。「0〜6ヶ月」は [0, 6](月で書いた上限はそのまま)、「1〜2歳」は [12, 36](歳で書いた上限は
 * その歳の終わりまで)、「1歳」は [12, 24]、「(36-84)」のように括弧の中に月齢があればそれを使う。
 * 「全年齢」は [0, AGE_MONTHS_MAX]。読めなければ null。
 */
export function parseMonthRange(cell: ImportCell): [number, number] | null {
  const raw = cellText(cell).normalize('NFKC').replace(/\s/g, '');
  if (!raw) return null;
  const paren = new RegExp(`\\((\\d+)${RANGE_SEP}+(\\d+)\\)`).exec(raw);
  if (paren) return [Number(paren[1]), Number(paren[2])];
  const text = raw.replace(/\([^)]*\)/g, '');
  if (/^全年齢/.test(text)) return [0, AGE_MONTHS_MAX];
  let m = new RegExp(`^(\\d+)${MONTH_UNIT}?${RANGE_SEP}+(\\d+)${MONTH_UNIT}$`).exec(text);
  if (m) return [Number(m[1]), Number(m[2])];
  m = new RegExp(`^(\\d+)(?:歳)?${RANGE_SEP}+(\\d+)歳`).exec(text);
  if (m) return [Number(m[1]) * 12, (Number(m[2]) + 1) * 12];
  m = new RegExp(`^(\\d+)${MONTH_UNIT}$`).exec(text);
  if (m) return [Number(m[1]), Number(m[1])];
  m = /^(\d+)歳/.exec(text);
  if (m) return [Number(m[1]) * 12, (Number(m[1]) + 1) * 12];
  return null;
}

/** キーワードID の並び(「K11 K12 K24」「K11、K12」)。 */
export function parseCodeList(cell: ImportCell): string[] {
  return cellText(cell)
    .normalize('NFKC')
    .split(/[\s,、・/|｜;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** 表現の区分(「◎使う」→ warm、「✕避ける」→ avoid)。読めなければ null。 */
export function parsePhraseKind(cell: ImportCell): 'warm' | 'avoid' | null {
  const text = cellText(cell).normalize('NFKC').toLowerCase();
  if (/[✕×✗✘]|避|ng|禁止|avoid|^x/.test(text)) return 'avoid';
  if (/[◎○◯]|使う|推奨|温かみ|warm/.test(text)) return 'warm';
  return null;
}

/** 用語名の扱いの文言から決める(「用語名NG」「出さない」→ forbid、「控えめ」→ sparing、「OK」「積極」→ allow)。 */
export function parseTermNamePolicy(cell: ImportCell): TermNamePolicy | null {
  const text = cellText(cell).normalize('NFKC').toLowerCase();
  if (!text) return null;
  if (/ng|出さない|使わない|禁止|不可/.test(text)) return 'forbid';
  if (/控え/.test(text)) return 'sparing';
  if (/ok|積極|出してよい|可/.test(text)) return 'allow';
  return null;
}

type FieldSpec = { aliases: readonly string[] };
type SheetSpec<F extends string> = {
  kind: ReportAiMasterKind;
  fields: Record<F, FieldSpec>;
  /** 見出しに全てあればこの種類のシート。 */
  required: readonly F[];
};

const KEYWORD_SPEC: SheetSpec<
  | 'code'
  | 'category'
  | 'keyword'
  | 'subConcept'
  | 'ageLabel'
  | 'ageFrom'
  | 'ageTo'
  | 'ageBandLabel'
  | 'levels'
  | 'psiMin'
  | 'tone'
  | 'parentExplanation'
  | 'phraseExamples'
  | 'usageScene'
  | 'ngExample'
  | 'sortOrder'
> = {
  kind: 'keywords',
  fields: {
    code: { aliases: ['ID', 'キーワードID', 'コード', 'code'] },
    category: { aliases: ['カテゴリ', 'カテゴリー', '分類'] },
    keyword: { aliases: ['キーワード', 'キーワード名', '用語'] },
    subConcept: { aliases: ['サブ概念', '副題'] },
    ageLabel: { aliases: ['対象年齢(表示)', '対象年齢(月齢)', '対象年齢'] },
    ageFrom: { aliases: ['年齢下限_月齢', '年齢下限', '月齢下限'] },
    ageTo: { aliases: ['年齢上限_月齢', '年齢上限', '月齢上限'] },
    ageBandLabel: { aliases: ['適用年齢帯'] },
    levels: { aliases: ['教育思考レベル適用★', '適用★', '教育思考レベル'] },
    psiMin: { aliases: ['PSI下限(この値以上で使用可)', 'PSI下限'] },
    tone: { aliases: ['トーン種別', 'トーン'] },
    parentExplanation: { aliases: ['親向け説明（やさしい言い換え）', '親向け説明'] },
    phraseExamples: { aliases: ['日報フレーズ例（見ていた人スタンス）', '日報フレーズ例', 'フレーズ例'] },
    usageScene: { aliases: ['使いどころ・場面', '使いどころ'] },
    ngExample: { aliases: ['この語でのNG例（避ける上から目線）', 'この語でのNG例', 'NG例'] },
    sortOrder: { aliases: ['並び順', '表示順'] },
  },
  required: ['code', 'keyword', 'levels'],
};

const AGE_BAND_SPEC: SheetSpec<
  | 'label'
  | 'range'
  | 'ageFrom'
  | 'ageTo'
  | 'behaviorWords'
  | 'developmentTopics'
  | 'keywordCodes'
  | 'sceneExamples'
  | 'sortOrder'
> = {
  kind: 'ageBands',
  fields: {
    label: { aliases: ['年齢帯'] },
    range: { aliases: ['月齢範囲'] },
    ageFrom: { aliases: ['月齢下限'] },
    ageTo: { aliases: ['月齢上限'] },
    behaviorWords: { aliases: ['この時期によく描写する行動・単語', '行動・単語', '行動語'] },
    developmentTopics: { aliases: ['発達の主なトピック', '発達トピック'] },
    keywordCodes: { aliases: ['相性の良いキーワードID', '相性キーワードID'] },
    sceneExamples: { aliases: ['場面例'] },
    sortOrder: { aliases: ['並び順', '表示順'] },
  },
  required: ['label', 'range'],
};

const EDUCATION_LEVEL_SPEC: SheetSpec<
  | 'level'
  | 'label'
  | 'customerProfile'
  | 'usage'
  | 'wordScope'
  | 'termNameRule'
  | 'count'
  | 'toneFocus'
  | 'exampleDirection'
> = {
  kind: 'educationLevels',
  fields: {
    level: { aliases: ['レベル★', 'レベル', '教育思考レベル'] },
    label: { aliases: ['呼称'] },
    customerProfile: { aliases: ['想定顧客像'] },
    usage: { aliases: ['教育語の使い方'] },
    wordScope: { aliases: ['使ってよい語の範囲'] },
    termNameRule: { aliases: ['用語名の扱い'] },
    count: { aliases: ['1通あたり教育語'] },
    toneFocus: { aliases: ['トーンの主眼'] },
    exampleDirection: { aliases: ['例文の方向性'] },
  },
  required: ['level', 'count'],
};

const PSI_LEVEL_SPEC: SheetSpec<'level' | 'label' | 'criteria'> = {
  kind: 'psiLevels',
  fields: {
    level: { aliases: ['評価', 'PSI'] },
    label: { aliases: ['定義'] },
    criteria: { aliases: ['判定基準'] },
  },
  required: ['level', 'label', 'criteria'],
};

const PHRASE_SPEC: SheetSpec<'kind' | 'body' | 'message' | 'psi' | 'note' | 'sortOrder'> = {
  kind: 'phrases',
  fields: {
    kind: { aliases: ['区分'] },
    body: { aliases: ['表現例／避ける言い回し', '表現例', '表現', '言い回し'] },
    message: { aliases: ['込めるメッセージ／理由', '込めるメッセージ', 'メッセージ'] },
    psi: { aliases: ['推奨PSI・適用範囲', '推奨PSI'] },
    note: { aliases: ['備考'] },
    sortOrder: { aliases: ['並び順', '表示順'] },
  },
  required: ['kind', 'body'],
};

const STANCE_SPEC: SheetSpec<'topic' | 'avoidText' | 'recommendedText' | 'reason' | 'sortOrder'> = {
  kind: 'stanceRules',
  fields: {
    topic: { aliases: ['項目'] },
    avoidText: { aliases: ['✕避ける（上から目線・評価）', '避ける'] },
    recommendedText: { aliases: ['◎推奨（見ていた人・共感）', '推奨'] },
    reason: { aliases: ['理由'] },
    sortOrder: { aliases: ['並び順', '表示順'] },
  },
  required: ['topic', 'avoidText', 'recommendedText'],
};

// biome-ignore lint/suspicious/noExplicitAny: 種類ごとに列の名前が違うため
const SPECS: readonly SheetSpec<any>[] = [
  KEYWORD_SPEC,
  AGE_BAND_SPEC,
  EDUCATION_LEVEL_SPEC,
  PSI_LEVEL_SPEC,
  PHRASE_SPEC,
  STANCE_SPEC,
];

const HEADER_SEARCH_ROWS = 10;

/** 見出しの行から列の位置を決める(別名の早いものから。1つの列は1つの項目にだけ使う)。 */
function mapColumns<F extends string>(spec: SheetSpec<F>, header: readonly ImportCell[]): Map<F, number> {
  const normalized = header.map((cell) => normalizeHeader(cellText(cell)));
  const used = new Set<number>();
  const columns = new Map<F, number>();
  for (const [field, { aliases }] of Object.entries(spec.fields) as [F, FieldSpec][]) {
    for (const alias of aliases) {
      const target = normalizeHeader(alias);
      const index = normalized.findIndex((h, i) => h !== '' && h === target && !used.has(i));
      if (index >= 0) {
        columns.set(field, index);
        used.add(index);
        break;
      }
    }
  }
  return columns;
}

interface DetectedSheet {
  // biome-ignore lint/suspicious/noExplicitAny: 種類ごとに列の名前が違うため
  spec: SheetSpec<any>;
  headerRow: number;
  columns: Map<string, number>;
}

/** シートの種類と見出しの行(0始まり)を決める。当てはまる種類が複数なら、読める列の多い方。 */
export function detectSheet(sheet: ReportAiImportSheet): DetectedSheet | null {
  let best: (DetectedSheet & { score: number }) | null = null;
  for (let r = 0; r < Math.min(HEADER_SEARCH_ROWS, sheet.rows.length); r++) {
    const header = sheet.rows[r] ?? [];
    for (const spec of SPECS) {
      const columns = mapColumns(spec, header);
      if (!spec.required.every((f: string) => columns.has(f))) continue;
      if (!best || columns.size > best.score) best = { spec, headerRow: r, columns, score: columns.size };
    }
    if (best) return best;
  }
  return null;
}

type RowReader = {
  text: (field: string) => string;
  cell: (field: string) => ImportCell;
  has: (field: string) => boolean;
};

function readerOf(row: readonly ImportCell[], columns: Map<string, number>): RowReader {
  const cell = (field: string) => {
    const index = columns.get(field);
    return index === undefined ? null : row[index];
  };
  return { cell, text: (field) => cellText(cell(field)), has: (field) => columns.has(field) };
}

const orNull = (text: string) => (text === '' ? null : text);

type Built = { key: string; value: unknown } | { error: string };

function buildKeyword(r: RowReader, index: number): Built {
  const levels = parseLevelRange(r.cell('levels'));
  if (!levels)
    return {
      error: `教育思考レベル適用★「${r.text('levels')}」を読めません(「4-5」「3」のように書いてください)`,
    };
  const fromCell = r.has('ageFrom') ? parseInteger(r.cell('ageFrom')) : null;
  const toCell = r.has('ageTo') ? parseInteger(r.cell('ageTo')) : null;
  const labelRange = parseMonthRange(r.cell('ageLabel'));
  const from = fromCell ?? labelRange?.[0] ?? null;
  const to = toCell ?? labelRange?.[1] ?? null;
  if (from === null || to === null) {
    return { error: '年齢下限・年齢上限(月齢)を読めません' };
  }
  const psiMin = r.has('psiMin') ? parseInteger(r.cell('psiMin')) : REPORT_LEVEL_MIN;
  if (psiMin === null) return { error: `PSI下限「${r.text('psiMin')}」を読めません` };
  const ageLabel = r
    .text('ageLabel')
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, '')
    .trim();
  return parsed(
    reportKeywordInputSchema,
    {
      code: r.text('code').normalize('NFKC'),
      category: orNull(r.text('category')),
      keyword: r.text('keyword'),
      subConcept: orNull(r.text('subConcept')),
      ageLabel: orNull(ageLabel),
      ageFromMonths: from,
      ageToMonths: to,
      ageBandLabel: orNull(r.text('ageBandLabel')),
      educationLevelMin: levels[0],
      educationLevelMax: levels[1],
      psiMin,
      tone: orNull(r.text('tone')),
      parentExplanation: orNull(r.text('parentExplanation')),
      phraseExamples: orNull(r.text('phraseExamples')),
      usageScene: orNull(r.text('usageScene')),
      ngExample: orNull(r.text('ngExample')),
      sortOrder: parseInteger(r.cell('sortOrder')) ?? index,
    },
    (v) => v.code.toUpperCase(),
  );
}

function buildAgeBand(r: RowReader, index: number): Built {
  const range = parseMonthRange(r.cell('range'));
  const from = parseInteger(r.cell('ageFrom')) ?? range?.[0] ?? null;
  const to = parseInteger(r.cell('ageTo')) ?? range?.[1] ?? null;
  if (from === null || to === null) {
    return { error: `月齢範囲「${r.text('range')}」を読めません(「0〜6ヶ月」のように書いてください)` };
  }
  return parsed(
    reportAgeBandInputSchema,
    {
      label: r.text('label').normalize('NFKC'),
      ageFromMonths: from,
      ageToMonths: to,
      behaviorWords: orNull(r.text('behaviorWords')),
      developmentTopics: orNull(r.text('developmentTopics')),
      keywordCodes: parseCodeList(r.cell('keywordCodes')),
      sceneExamples: orNull(r.text('sceneExamples')),
      sortOrder: parseInteger(r.cell('sortOrder')) ?? index,
    },
    (v) => v.label,
  );
}

function buildEducationLevel(r: RowReader): Built {
  const level = parseInteger(r.cell('level'));
  if (level === null) return { error: `レベル★「${r.text('level')}」を読めません(「★1」〜「★5」)` };
  const count = parseCountRange(r.cell('count'));
  if (!count)
    return { error: `1通あたり教育語「${r.text('count')}」を読めません(「0〜1個」のように書いてください)` };
  const termNameRule = r.text('termNameRule');
  const policy = parseTermNamePolicy(termNameRule) ?? (count[1] === 0 ? 'forbid' : 'sparing');
  return parsed(
    reportEducationLevelInputSchema,
    {
      level,
      label: orNull(r.text('label')),
      customerProfile: orNull(r.text('customerProfile')),
      usage: orNull(r.text('usage')),
      wordScope: orNull(r.text('wordScope')),
      termNameRule: orNull(termNameRule),
      termNamePolicy: policy,
      keywordsMin: count[0],
      keywordsMax: count[1],
      toneFocus: orNull(r.text('toneFocus')),
      exampleDirection: orNull(r.text('exampleDirection')),
    },
    (v) => String(v.level),
  );
}

function buildPsiLevel(r: RowReader): Built {
  const level = parseInteger(r.cell('level'));
  if (level === null) return { error: `評価「${r.text('level')}」を読めません(5〜1)` };
  return parsed(
    reportPsiLevelInputSchema,
    {
      level,
      label: r.text('label'),
      criteria: orNull(r.text('criteria')),
    },
    (v) => String(v.level),
  );
}

function buildPhrase(r: RowReader, index: number): Built {
  const kind = parsePhraseKind(r.cell('kind'));
  if (!kind) return { error: `区分「${r.text('kind')}」を読めません(「◎使う」か「✕避ける」)` };
  const psiText = r.text('psi');
  const range = psiText ? parsePsiRange(psiText) : [REPORT_LEVEL_MIN, REPORT_LEVEL_MAX];
  if (!range)
    return {
      error: `推奨PSI・適用範囲「${psiText}」を読めません(「1〜4」「全PSI可」のように書いてください)`,
    };
  return parsed(
    reportPhraseInputSchema,
    {
      kind,
      body: r.text('body'),
      message: orNull(r.text('message')),
      psiMin: range[0],
      psiMax: range[1],
      note: orNull(r.text('note')),
      sortOrder: parseInteger(r.cell('sortOrder')) ?? index,
    },
    (v) => `${v.kind}:${v.body}`,
  );
}

function buildStanceRule(r: RowReader, index: number): Built {
  return parsed(
    reportStanceRuleInputSchema,
    {
      topic: r.text('topic'),
      avoidText: orNull(r.text('avoidText')),
      recommendedText: orNull(r.text('recommendedText')),
      reason: orNull(r.text('reason')),
      sortOrder: parseInteger(r.cell('sortOrder')) ?? index,
    },
    (v) => v.topic,
  );
}

/** 契約のスキーマ(zod)のうち、ここで使う形。 */
interface SafeParser<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string; path: (string | number)[] }[] } };
}

function parsed<T>(schema: SafeParser<T>, input: unknown, keyOf: (v: T) => string): Built {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { error: issue ? `${issue.message}(${issue.path.join('.') || '行'})` : '値が正しくありません' };
  }
  return { key: keyOf(result.data), value: result.data };
}

const BUILDERS: Record<ReportAiMasterKind, (r: RowReader, index: number) => Built> = {
  keywords: buildKeyword,
  ageBands: buildAgeBand,
  educationLevels: buildEducationLevel,
  psiLevels: buildPsiLevel,
  phrases: buildPhrase,
  stanceRules: buildStanceRule,
};

/** 注記の行(1つのセルだけに文字がある「■…」「※…」の行)。 */
function isNoteRow(row: readonly ImportCell[], keyColumn: number | undefined): boolean {
  const filled = row.filter((c) => cellText(c) !== '');
  if (filled.length === 0) return true;
  const key = keyColumn === undefined ? '' : cellText(row[keyColumn]);
  return filled.length === 1 && (key === '' || /^[■※●◆]/.test(key));
}

/** ワークブックのシートを読む。 */
export function parseReportAiWorkbook(sheets: readonly ReportAiImportSheet[]): ParsedReportAiImport {
  const result: ParsedReportAiImport = {
    keywords: [],
    ageBands: [],
    educationLevels: [],
    psiLevels: [],
    phrases: [],
    stanceRules: [],
    rowCounts: { keywords: 0, ageBands: 0, educationLevels: 0, psiLevels: 0, phrases: 0, stanceRules: 0 },
    errors: [],
    warnings: [],
  };
  /** 種類 → キー → { シート, 何番目 }。 */
  const seen = new Map<ReportAiMasterKind, Map<string, { sheet: string; index: number }>>();
  for (const sheet of sheets) {
    const detected = detectSheet(sheet);
    if (!detected) {
      result.warnings.push({
        sheet: sheet.name,
        row: null,
        message: '取込む表の見出しが無いため、このシートは読みませんでした',
      });
      continue;
    }
    const kind = detected.spec.kind;
    const keyField = detected.spec.required[0] as string;
    const keyColumn = detected.columns.get(keyField);
    const list = result[kind] as unknown[];
    const keys = seen.get(kind) ?? new Map();
    seen.set(kind, keys);
    let index = 0;
    for (let r = detected.headerRow + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      if (isNoteRow(row, keyColumn)) continue;
      result.rowCounts[kind]++;
      const built = BUILDERS[kind](readerOf(row, detected.columns), index++);
      const excelRow = r + 1;
      if ('error' in built) {
        result.errors.push({ sheet: sheet.name, row: excelRow, message: built.error });
        continue;
      }
      const previous = keys.get(built.key);
      if (previous && previous.sheet === sheet.name) {
        result.errors.push({
          sheet: sheet.name,
          row: excelRow,
          message: `同じキー「${built.key}」の行が2つあります`,
        });
        continue;
      }
      if (previous) {
        list[previous.index] = built.value;
        result.warnings.push({
          sheet: sheet.name,
          row: excelRow,
          message: `「${built.key}」はシート「${previous.sheet}」にもあるため、このシートの行を使います`,
        });
        keys.set(built.key, { sheet: sheet.name, index: previous.index });
        continue;
      }
      keys.set(built.key, { sheet: sheet.name, index: list.length });
      list.push(built.value);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 書き出し(取込と同じ見出しのシート。書き出したファイルはそのまま取り込める)
// ─────────────────────────────────────────────────────────────

export interface ReportAiExportSheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

const rangeText = (min: number, max: number) => (min === max ? String(min) : `${min}-${max}`);

/** マスターをお客様の表と同じシート・見出しの表にする(xlsx への書き込みは API 側)。 */
export function reportAiMastersToSheets(masters: {
  keywords: readonly ReportKeywordInput[];
  ageBands: readonly ReportAgeBandInput[];
  educationLevels: readonly ReportEducationLevelInput[];
  psiLevels: readonly ReportPsiLevelInput[];
  phrases: readonly ReportPhraseInput[];
  stanceRules: readonly ReportStanceRuleInput[];
}): ReportAiExportSheet[] {
  const psiRangeText = (p: ReportPhraseInput) =>
    p.kind === 'avoid'
      ? '全日報で不使用（PSI問わず）'
      : p.psiMin === REPORT_LEVEL_MIN && p.psiMax === REPORT_LEVEL_MAX
        ? '全PSI可'
        : `${p.psiMin}〜${p.psiMax}`;
  return [
    {
      name: '01_マスター表',
      header: [
        'ID',
        'カテゴリ',
        'キーワード',
        'サブ概念',
        '対象年齢(表示)',
        '年齢下限_月齢',
        '年齢上限_月齢',
        '適用年齢帯',
        '教育思考レベル適用★',
        'PSI下限(この値以上で使用可)',
        'トーン種別',
        '親向け説明（やさしい言い換え）',
        '日報フレーズ例（見ていた人スタンス）',
        '使いどころ・場面',
        'この語でのNG例（避ける上から目線）',
      ],
      rows: masters.keywords.map((k) => [
        k.code,
        k.category,
        k.keyword,
        k.subConcept,
        k.ageLabel,
        k.ageFromMonths,
        k.ageToMonths,
        k.ageBandLabel,
        rangeText(k.educationLevelMin, k.educationLevelMax),
        k.psiMin,
        k.tone,
        k.parentExplanation,
        k.phraseExamples,
        k.usageScene,
        k.ngExample,
      ]),
    },
    {
      name: '02_年齢帯定義',
      header: [
        '年齢帯',
        '月齢範囲',
        'この時期によく描写する行動・単語',
        '発達の主なトピック',
        '相性の良いキーワードID',
        '場面例',
      ],
      rows: masters.ageBands.map((b) => [
        b.label,
        `${b.ageFromMonths}〜${b.ageToMonths}ヶ月`,
        b.behaviorWords,
        b.developmentTopics,
        b.keywordCodes.join(' '),
        b.sceneExamples,
      ]),
    },
    {
      name: '03_教育思考レベル定義',
      header: [
        'レベル★',
        '呼称',
        '想定顧客像',
        '教育語の使い方',
        '使ってよい語の範囲',
        '用語名の扱い',
        '1通あたり教育語',
        'トーンの主眼',
        '例文の方向性',
      ],
      rows: masters.educationLevels.map((l) => [
        `★${l.level}`,
        l.label,
        l.customerProfile,
        l.usage,
        l.wordScope,
        l.termNameRule ??
          { forbid: '用語名NG', sparing: '用語名は控えめ', allow: '用語名OK・必ず説明とセット' }[
            l.termNamePolicy
          ],
        l.keywordsMin === l.keywordsMax ? `${l.keywordsMax}個` : `${l.keywordsMin}〜${l.keywordsMax}個`,
        l.toneFocus,
        l.exampleDirection,
      ]),
    },
    {
      name: '04_PSI指標定義',
      header: ['評価', '定義', '判定基準'],
      rows: masters.psiLevels.map((p) => [String(p.level), p.label, p.criteria]),
    },
    {
      name: '05_温かみ表現_PSI配慮',
      header: ['区分', '表現例／避ける言い回し', '込めるメッセージ／理由', '推奨PSI・適用範囲', '備考'],
      rows: masters.phrases.map((p) => [
        p.kind === 'warm' ? '◎使う' : '✕避ける',
        p.body,
        p.message,
        psiRangeText(p),
        p.note,
      ]),
    },
    {
      name: '06_見ていた人スタンス_NG表現',
      header: ['項目', '✕避ける（上から目線・評価）', '◎推奨（見ていた人・共感）', '理由'],
      rows: masters.stanceRules.map((s) => [s.topic, s.avoidText, s.recommendedText, s.reason]),
    },
  ];
}
