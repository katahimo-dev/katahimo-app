import {
  ASSESSMENT_DEFINITIONS,
  DEFAULT_EDUCATION_LEVEL,
  DEFAULT_PSI_FOR_PROMPT,
  MAX_KEYWORD_CANDIDATES,
  MAX_KEYWORDS_PER_REPORT,
  PSI_ALERT_MAX,
  PSI_ESCALATION_LEVEL,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
  REPORT_PROMPT_PLACEHOLDERS,
  REPORT_PROMPT_SECTIONS,
  type ReportPromptPlaceholder,
  type ReportPromptSection,
  type TermNamePolicy,
} from '@katahimo/shared';
import {
  DEFAULT_EDUCATION_LEVEL_RULES,
  type ReportAgeBandEntry,
  type ReportAiMasters,
  type ReportEducationLevelEntry,
  type ReportKeywordEntry,
  type ReportPhraseEntry,
} from './reportAiMasters';

/**
 * 保育日報の生成プロンプトを、テナントの文面(AIプロンプト)とマスター(日報キーワード表現マスター)と、
 * 家庭・訪問ごとの値(対象児の月齢・教育思考★・PSI)から組み立てる純関数。
 *
 * お客様のマスターのシート00「使い方」・シート07「参照フロー」の手順どおりに、AI に渡す前に言葉を絞り込む:
 *   STEP1 子の月齢 → 年齢帯(シート02)。描写する行動語・相性の良いキーワードID を取る。
 *   STEP2 PSI(シート04)。PSIは教育スコアに優先する。5・4 = ★どおり / 3 = ★を1〜2段下げ、専門語は避ける /
 *         2 = 教育語オフ → 温かみ表現(シート05)/ 1 = 教育語オフ・安全対応を最優先し管理者へ連絡。
 *   STEP3 使用可否 = (対象月齢 ∈ [年齢下限, 年齢上限]) かつ (家庭の★ ∈ 適用★) かつ (家庭のPSI ≧ PSI下限)。
 *   STEP4 1通あたり教育語は1〜2個まで(★の定義の「1通あたり教育語」も超えない)。用語名は親向け説明とセット。
 *   STEP5 文体は「見ていた人」スタンス(シート06)。避ける表現(シート05 の✕)はPSIに関わらず全ての日報で使わない。
 * 絞り込みの結果(候補の並び)は決定的で、生成の記録(report_ai_generations)と突き合わせられる。
 *
 * 未入力の扱いはお客様の「プロンプト変更案」の注記どおり: ★が未設定の家庭は★2、PSI が未評価の訪問は PSI 4
 * (通常運用)として絞り込む(プロンプトには「未入力」と書き、同じ既定値を AI にも伝える)。対象児を選んでいない・
 * 生年月日が分からないときは年齢帯の言葉を渡さず、キーワードの月齢の条件は AI がメモから推定する(表に対象年齢の
 * 列を残す)。管理者への連絡(エスカレーション)は、スタッフが PSI 1 を付けたときだけ。
 */

/** 月齢(満)。生年月日・基準日は 'YYYY-MM-DD'。形が違う・基準日が生年月日より前なら null。 */
export function ageInMonths(birthDate: string, onDate: string): number | null {
  const parse = (value: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { y, mo, d } : null;
  };
  const birth = parse(birthDate);
  const on = parse(onDate);
  if (!birth || !on) return null;
  let months = (on.y - birth.y) * 12 + (on.mo - birth.mo);
  if (on.d < birth.d) months -= 1;
  return months < 0 ? null : months;
}

/** 「1歳2か月(月齢14か月)」「8か月(月齢8か月)」。 */
export function formatChildAge(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const text = years === 0 ? `${months}か月` : `${years}歳${rest}か月`;
  return `${text}（月齢${months}か月）`;
}

const clampLevel = (level: number) => Math.min(REPORT_LEVEL_MAX, Math.max(REPORT_LEVEL_MIN, level));

/** 月齢が [from, to) に入る年齢帯(重なっていれば並び順が先のもの)。 */
export function findAgeBand(bands: readonly ReportAgeBandEntry[], months: number): ReportAgeBandEntry | null {
  return (
    [...bands]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.ageFromMonths - b.ageFromMonths)
      .find((band) => months >= band.ageFromMonths && months < band.ageToMonths) ?? null
  );
}

/** STEP2 の結果。 */
export interface PsiAdjustment {
  /** 絞り込みに使う PSI(未評価は DEFAULT_PSI_FOR_PROMPT)。 */
  psi: number;
  /** スタッフが PSI を付けたか。 */
  rated: boolean;
  /** 家庭の★(未設定は DEFAULT_EDUCATION_LEVEL)。 */
  educationLevel: number;
  /** PSI で調整したあとの★。PSI 2 以下は教育語を使わないので null。 */
  effectiveEducationLevel: number | null;
  keywordsEnabled: boolean;
  /** PSI 3 は専門語(用語名)を避ける。 */
  termNamesForbidden: boolean;
  /** PSI 1(危険・緊急)。スタッフが付けたときだけ。 */
  escalationRequired: boolean;
}

/**
 * PSI を教育思考★に適用する(PSIは教育スコアに優先する)。PSI 3 の「★を1〜2段下げる」は、専門語を避ける
 * (★4・★5 だけの語を使わない)ため★3以下になるまで下げる: ★5 → ★3(2段)、★4 → ★3、★3 → ★2、★2 → ★1(1段)。
 */
export function applyPsi(educationLevel: number | null, riskRating: number | null): PsiAdjustment {
  const base = clampLevel(educationLevel ?? DEFAULT_EDUCATION_LEVEL);
  const rated = riskRating !== null;
  const psi = clampLevel(riskRating ?? DEFAULT_PSI_FOR_PROMPT);
  if (psi <= PSI_ALERT_MAX) {
    return {
      psi,
      rated,
      educationLevel: base,
      effectiveEducationLevel: null,
      keywordsEnabled: false,
      termNamesForbidden: true,
      escalationRequired: rated && psi === PSI_ESCALATION_LEVEL,
    };
  }
  const effective = psi === 3 ? clampLevel(Math.min(base - 1, 3)) : base;
  return {
    psi,
    rated,
    educationLevel: base,
    effectiveEducationLevel: effective,
    keywordsEnabled: true,
    termNamesForbidden: psi === 3,
    escalationRequired: false,
  };
}

/**
 * キーワードの月齢の条件(両端を含む)。月齢が分からないときは絞らない(お客様の変更案の「月齢が未入力ならメモ本文から
 * 推定する」: 表に対象年齢(月齢)の列を載せ、AI が当てはめる)。
 */
function keywordMatchesAge(keyword: ReportKeywordEntry, months: number | null): boolean {
  if (months === null) return true;
  return months >= keyword.ageFromMonths && months <= keyword.ageToMonths;
}

export interface SelectKeywordsInput {
  keywords: readonly ReportKeywordEntry[];
  /** 対象児の月齢。分からなければ null(月齢の条件は AI がメモから推定する。表に対象年齢を載せる)。 */
  childAgeMonths: number | null;
  adjustment: PsiAdjustment;
  /** 年齢帯の「相性の良いキーワードID」(この順に先頭へ)。 */
  affinityCodes?: readonly string[];
  /** ★の定義の1通あたり教育語の上限が0なら候補を出さない。 */
  maxKeywords: number;
  maxCandidates?: number;
}

/**
 * STEP3: 3つの条件を全部満たす語だけを候補にする(1つでも×ならその語は使わない)。並びは 相性の良い語(年齢帯の
 * 並びの順)→ 表の並び順 → ID。
 */
export function selectKeywordCandidates(input: SelectKeywordsInput): ReportKeywordEntry[] {
  const level = input.adjustment.effectiveEducationLevel;
  if (!input.adjustment.keywordsEnabled || level === null || input.maxKeywords <= 0) return [];
  const affinity = new Map((input.affinityCodes ?? []).map((code, index) => [code.toUpperCase(), index]));
  const rank = (k: ReportKeywordEntry) => affinity.get(k.code.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  return input.keywords
    .filter((k) => keywordMatchesAge(k, input.childAgeMonths))
    .filter((k) => level >= k.educationLevelMin && level <= k.educationLevelMax)
    .filter((k) => input.adjustment.psi >= k.psiMin)
    .sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .slice(0, input.maxCandidates ?? MAX_KEYWORD_CANDIDATES);
}

/** 表現を区分で選ぶ。温かみ表現は PSI が推奨の範囲に入るものだけ、避ける表現は全て。並び順 → 本文。 */
export function selectPhrases(
  phrases: readonly ReportPhraseEntry[],
  kind: ReportPhraseEntry['kind'],
  psi: number,
): ReportPhraseEntry[] {
  return phrases
    .filter((p) => p.kind === kind && (kind === 'avoid' || (psi >= p.psiMin && psi <= p.psiMax)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.body.localeCompare(b.body));
}

/** ★の定義(テナントのシート03 の行、無ければ既定の数と用語名の扱い)。 */
type EducationRule = Pick<ReportEducationLevelEntry, 'keywordsMin' | 'keywordsMax' | 'termNamePolicy'> &
  Partial<ReportEducationLevelEntry>;

function educationRuleOf(levels: readonly ReportEducationLevelEntry[], level: number): EducationRule {
  const found = levels.find((l) => l.level === level);
  if (found) return found;
  return DEFAULT_EDUCATION_LEVEL_RULES[level] ?? { keywordsMin: 0, keywordsMax: 0, termNamePolicy: 'forbid' };
}

/** ★の定義に「用語名の扱い」の文言が無いときの書き方。 */
const TERM_NAME_TEXT: Record<TermNamePolicy, string> = {
  forbid: '用語名は出さず、親向け説明の言い換えだけを使う',
  sparing: '概念は説明し、用語名は控えめにする（出すときは親向け説明とセット）',
  allow: '用語名を出すときは必ず親向け説明とセットにする',
};

const oneLine = (text: string | null | undefined) => (text ?? '').replace(/\s*\n\s*/g, ' ').trim();

/** 【日報キーワード表】の1行(お客様の表と同じ列: ID｜カテゴリ｜キーワード｜対象年齢(月齢)｜適用★｜PSI下限｜親向け説明｜日報フレーズ例)。 */
export function formatKeywordRow(k: ReportKeywordEntry): string {
  const stars =
    k.educationLevelMin === k.educationLevelMax
      ? String(k.educationLevelMin)
      : `${k.educationLevelMin}-${k.educationLevelMax}`;
  const phrases = (k.phraseExamples ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' / ');
  return [
    k.code,
    oneLine(k.category),
    oneLine(k.keyword),
    `${oneLine(k.ageLabel)}(${k.ageFromMonths}-${k.ageToMonths})`,
    stars,
    String(k.psiMin),
    oneLine(k.parentExplanation),
    phrases,
  ].join('｜');
}

function keywordTableOf(candidates: readonly ReportKeywordEntry[], adjustment: PsiAdjustment): string {
  if (candidates.length > 0) return candidates.map(formatKeywordRow).join('\n');
  if (!adjustment.keywordsEnabled) {
    return `（PSI ${adjustment.psi}のため、この日報では教育キーワードを使わない。温かみ表現で寄り添うこと）`;
  }
  return '（この家庭・月齢で使える教育キーワードはありません。教育キーワードは使わないこと）';
}

const psiLabelOf = (masters: ReportAiMasters, psi: number) =>
  masters.psiLevels.find((p) => p.level === psi)?.label ??
  ASSESSMENT_DEFINITIONS.risk.levels.find((l) => l.score === psi)?.label ??
  null;

function levelGuideOf(
  masters: ReportAiMasters,
  adjustment: PsiAdjustment,
  rule: EducationRule,
  maxKeywords: number,
): string {
  const level = adjustment.effectiveEducationLevel;
  if (level === null || masters.keywords.length === 0) return '';
  const lines = ['', `【教育思考★${level}${rule.label ? `（${rule.label}）` : ''}の書き方】`];
  if (adjustment.psi === 3 && level !== adjustment.educationLevel) {
    lines.push(
      `・PSI 3（要観察）のため、家庭の★${adjustment.educationLevel}を★${level}に下げて控えめにする。専門語は避ける。`,
    );
  }
  if (rule.usage) lines.push(`・教育語の使い方：${oneLine(rule.usage)}`);
  if (rule.wordScope) lines.push(`・使ってよい語の範囲：${oneLine(rule.wordScope)}`);
  const termText = adjustment.termNamesForbidden
    ? '用語名は出さず、親向け説明の言い換えだけを使う'
    : rule.termNameRule
      ? oneLine(rule.termNameRule)
      : TERM_NAME_TEXT[rule.termNamePolicy];
  lines.push(`・用語名の扱い：${termText}`);
  const min = Math.min(rule.keywordsMin, maxKeywords);
  lines.push(
    `・1通あたり教育語：${min === maxKeywords ? `${maxKeywords}個` : `${min}〜${maxKeywords}個`}まで`,
  );
  if (rule.toneFocus) lines.push(`・トーンの主眼：${oneLine(rule.toneFocus)}`);
  if (rule.exampleDirection) lines.push(`・例文の方向性：${oneLine(rule.exampleDirection)}`);
  return lines.join('\n');
}

function ageBandGuideOf(band: ReportAgeBandEntry | null): string {
  if (!band) return '';
  const lines = ['', `【年齢帯：${band.label}（月齢${band.ageFromMonths}〜${band.ageToMonths}か月）】`];
  if (band.behaviorWords) lines.push(`・この時期によく描写する行動・単語：${oneLine(band.behaviorWords)}`);
  if (band.developmentTopics) lines.push(`・発達の主なトピック：${oneLine(band.developmentTopics)}`);
  if (band.sceneExamples) lines.push(`・場面例：${oneLine(band.sceneExamples)}`);
  if (band.keywordCodes.length > 0) lines.push(`・相性の良いキーワードID：${band.keywordCodes.join(' ')}`);
  return lines.join('\n');
}

function warmPhrasesOf(phrases: readonly ReportPhraseEntry[], adjustment: PsiAdjustment): string {
  if (phrases.length === 0) return '';
  const heading = adjustment.keywordsEnabled
    ? `【温かみ表現】（PSI ${adjustment.psi}で使える表現。締めなどに自然に添えてよい）`
    : `【温かみ表現】（PSI ${adjustment.psi}のため教育語の代わりに、ここから選んで伴走トーンで寄り添い・締める）`;
  const lines = ['', heading];
  for (const p of phrases) {
    const notes = [oneLine(p.message), oneLine(p.note)].filter(Boolean).join('／');
    lines.push(`・${oneLine(p.body)}${notes ? `（${notes}）` : ''}`);
  }
  return lines.join('\n');
}

function avoidPhrasesOf(phrases: readonly ReportPhraseEntry[]): string {
  if (phrases.length === 0) return '';
  const lines = ['', '【避ける表現】（PSIに関わらず全ての日報で使わない）'];
  for (const p of phrases) {
    lines.push(`・${oneLine(p.body)}${p.message ? `（${oneLine(p.message)}）` : ''}`);
  }
  return lines.join('\n');
}

function stanceGuideOf(masters: ReportAiMasters): string {
  if (masters.stanceRules.length === 0) return '';
  const rules = [...masters.stanceRules].sort((a, b) => a.sortOrder - b.sortOrder);
  const lines = [
    '',
    '【見ていた人スタンス】（✕避ける → ◎推奨。評価・上から目線は禁止し、観察→気づき→共感で締める）',
  ];
  for (const r of rules) {
    const parts = [
      r.avoidText ? `✕ ${oneLine(r.avoidText)}` : '',
      r.recommendedText ? `◎ ${oneLine(r.recommendedText)}` : '',
    ].filter(Boolean);
    lines.push(`・${oneLine(r.topic)}：${parts.join(' → ')}${r.reason ? `（${oneLine(r.reason)}）` : ''}`);
  }
  return lines.join('\n');
}

const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set(REPORT_PROMPT_PLACEHOLDERS.map((p) => p.name));
const SECTION_NAMES: ReadonlySet<string> = new Set(REPORT_PROMPT_SECTIONS);

/**
 * テンプレートの差し込みを置き換える。
 * - `{#name}` 〜 `{/name}` の行(それぞれ1行に単独で書く)の間は、sections[name] が true なら残し(目印の行は消す)、
 *   false なら丸ごと消す。閉じていない目印はそのまま文字として残す。
 * - 1行に差し込み `{name}` だけが書かれ、値が空の行は行ごと消す(マスターが空のテナントで空行を残さない)。
 * - `{name}` は1回の走査で全ての箇所を値にする(GAS版の String.replace は最初の1箇所だけだった)。差し込んだ値の中の
 *   `{…}` はもう一度置き換えない(メモに `{timeInfo}` と書かれていても、そのまま残る)。`$&` などの置換の記号も
 *   そのまま入る(GAS版は文字列で置き換えるため、メモの `$&` が差し込み位置の文字に化けた)。
 * - `{{name}}` は `{name}` という文字になる(注記の中で変数名を書くとき)。知らない `{…}` はそのまま(JSON の例)。
 */
export function renderPromptTemplate(
  template: string,
  values: Partial<Record<ReportPromptPlaceholder, string>>,
  sections: Partial<Record<ReportPromptSection, boolean>> = {},
): string {
  const lines = template.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const open = /^\s*\{#(\w+)\}\s*$/.exec(line);
    if (open && SECTION_NAMES.has(open[1] as string)) {
      const name = open[1] as ReportPromptSection;
      const close = lines.findIndex((l, j) => j > i && new RegExp(`^\\s*\\{/${name}\\}\\s*$`).test(l));
      if (close > i) {
        if (sections[name]) kept.push(...lines.slice(i + 1, close));
        i = close;
        continue;
      }
    }
    const single = /^\s*\{(\w+)\}\s*$/.exec(line);
    if (single && PLACEHOLDER_NAMES.has(single[1] as string)) {
      const value = values[single[1] as ReportPromptPlaceholder];
      if (value === '') continue;
    }
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (matched, escaped: string | undefined, name: string | undefined) => {
      if (escaped !== undefined) return `{${escaped}}`;
      if (name !== undefined && PLACEHOLDER_NAMES.has(name)) {
        const value = values[name as ReportPromptPlaceholder];
        return value ?? matched;
      }
      return matched;
    });
}

/** 時間情報(GAS版 generateReportWithWarnings: 開始と終了が両方あるときだけ「開始〜終了」、無ければ「時間指定なし」)。 */
export function dailyTimeInfo(start: string | undefined, end: string | undefined): string {
  return start && end ? `${start}〜${end}` : '時間指定なし';
}

/** 事故報告の時間情報(GAS版 generateAccidentReport: 終了が無くても開始だけで意味を持つ)。 */
export function accidentTimeInfo(start: string | undefined, end: string | undefined): string {
  return start && end ? `${start}〜${end}` : start || '時間指定なし';
}

export interface AssembleDailyReportPromptInput {
  /** AIプロンプト daily_report.generate(テナントの版または既定)。 */
  template: string;
  /** AIプロンプト daily_report.company_policy(空なら行ごと消える)。 */
  companyPolicy: string;
  anonymizedText: string;
  timeInfo: string;
  /** 対象児の月齢(未選択・生年月日不明は null)。 */
  childAgeMonths: number | null;
  /** 家庭の教育思考★(未設定は null)。 */
  educationLevel: number | null;
  /** スタッフが付けた PSI(未評価は null)。 */
  riskRating: number | null;
  masters: ReportAiMasters;
  maxCandidates?: number;
}

export interface AssembledDailyReportPrompt {
  prompt: string;
  /** プロンプトに載せた候補(この順)。 */
  candidates: ReportKeywordEntry[];
  ageBand: ReportAgeBandEntry | null;
  adjustment: PsiAdjustment;
  /** 1通あたりの教育語の上限(★の定義と MAX_KEYWORDS_PER_REPORT の小さい方。教育語を使わないときは0)。 */
  maxKeywords: number;
}

/** 3軸を適用して保育日報の生成プロンプトを組み立てる。 */
export function assembleDailyReportPrompt(input: AssembleDailyReportPromptInput): AssembledDailyReportPrompt {
  const { masters } = input;
  const adjustment = applyPsi(input.educationLevel, input.riskRating);
  const rule = educationRuleOf(
    masters.educationLevels,
    adjustment.effectiveEducationLevel ?? adjustment.educationLevel,
  );
  const maxKeywords = adjustment.keywordsEnabled ? Math.min(rule.keywordsMax, MAX_KEYWORDS_PER_REPORT) : 0;
  const ageBand = input.childAgeMonths === null ? null : findAgeBand(masters.ageBands, input.childAgeMonths);
  const candidates = selectKeywordCandidates({
    keywords: masters.keywords,
    childAgeMonths: input.childAgeMonths,
    adjustment,
    affinityCodes: ageBand?.keywordCodes ?? [],
    maxKeywords,
    ...(input.maxCandidates === undefined ? {} : { maxCandidates: input.maxCandidates }),
  });
  const eduLabel = masters.educationLevels.find((l) => l.level === adjustment.educationLevel)?.label;
  const psiLabel = psiLabelOf(masters, adjustment.psi);
  const hasKeywords = masters.keywords.length > 0;

  const prompt = renderPromptTemplate(
    input.template,
    {
      anonymizedText: input.anonymizedText,
      timeInfo: input.timeInfo,
      companyPolicy: input.companyPolicy.trim(),
      childAge: input.childAgeMonths === null ? '未入力' : formatChildAge(input.childAgeMonths),
      eduLevel:
        input.educationLevel === null
          ? '未入力'
          : `${adjustment.educationLevel}${eduLabel ? `（${eduLabel}）` : ''}`,
      psi: adjustment.rated ? `${adjustment.psi}${psiLabel ? `（${psiLabel}）` : ''}` : '未入力',
      keywordTable: hasKeywords ? keywordTableOf(candidates, adjustment) : '',
      levelGuide: levelGuideOf(masters, adjustment, rule, maxKeywords),
      ageBandGuide: ageBandGuideOf(ageBand),
      warmPhrases: warmPhrasesOf(selectPhrases(masters.phrases, 'warm', adjustment.psi), adjustment),
      avoidPhrases: avoidPhrasesOf(selectPhrases(masters.phrases, 'avoid', adjustment.psi)),
      stanceGuide: stanceGuideOf(masters),
    },
    { keywords: hasKeywords },
  );
  return { prompt, candidates, ageBand, adjustment, maxKeywords };
}

/** 事故報告の生成プロンプト(差し込みは入力メモと時間情報だけ。GAS版 generateAccidentReport)。 */
export function renderAccidentReportPrompt(
  template: string,
  anonymizedText: string,
  timeInfo: string,
): string {
  return renderPromptTemplate(template, { anonymizedText, timeInfo });
}

/** PSI 1 のときに AI の答えに関わらず warnings に必ず入れる知らせ。 */
export const ESCALATION_WARNING = '管理者へ連絡してください（PSI 1: 危険・緊急。安全対応を最優先）';

/** AI の warnings に管理者への連絡が無ければ足す(PSI 1)。 */
export function enforceEscalationWarning(warnings: readonly string[]): string[] {
  return warnings.some((w) => w.includes('管理者へ連絡')) ? [...warnings] : [...warnings, ESCALATION_WARNING];
}

export interface ResolvedUsedKeywords {
  /** 画面に出す(表に無い答えも known=false で残す)。 */
  items: { code: string; keyword: string | null; known: boolean }[];
  /** 表の行(キーワードの ID)。 */
  keywordIds: string[];
  /** 表に無い答え(そのままの文字列。長すぎる・多すぎる分は切る)。 */
  unresolved: string[];
}

/**
 * AI が「使った」と答えた教育キーワード(「K11 粗大運動」「K11」「粗大運動」のどれでも)を表の行に直す。
 * 先頭の ID で突き合わせ、無ければキーワード名で突き合わせる。同じ語は1回だけ。
 */
export function resolveUsedKeywords(
  answers: readonly unknown[] | undefined,
  keywords: readonly ReportKeywordEntry[],
): ResolvedUsedKeywords {
  const byCode = new Map(keywords.map((k) => [k.code.normalize('NFKC').toUpperCase(), k]));
  const byName = new Map(keywords.map((k) => [k.keyword.normalize('NFKC'), k]));
  const result: ResolvedUsedKeywords = { items: [], keywordIds: [], unresolved: [] };
  for (const raw of (answers ?? []).slice(0, 20)) {
    if (typeof raw !== 'string') continue;
    const text = raw.normalize('NFKC').trim();
    if (!text) continue;
    const [head = '', ...rest] = text.split(/\s+/);
    const hit = byCode.get(head.toUpperCase()) ?? byName.get(text) ?? byName.get(rest.join(' '));
    if (hit) {
      if (!result.keywordIds.includes(hit.id)) {
        result.keywordIds.push(hit.id);
        result.items.push({ code: hit.code, keyword: hit.keyword, known: true });
      }
    } else if (result.unresolved.length < 10) {
      const code = text.slice(0, 100);
      result.unresolved.push(code);
      result.items.push({ code, keyword: null, known: false });
    }
  }
  return result;
}
