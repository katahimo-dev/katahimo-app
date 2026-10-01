import { formatChildAge } from '@katahimo/core/domain';
import {
  type ComparisonCallResult,
  type ComparisonCase,
  type ComparisonDraft,
  type ComparisonModelSummary,
  type ComparisonSkip,
  type ComparisonUsedKeyword,
  summarizeReportAiComparison,
} from '@katahimo/core/usecases';

/**
 * 運用のモデル比較 `pnpm ai:compare` の結果を1つの HTML にする(外部のファイル・スクリプトを読まない。CSS は中に
 * 書く)。モデル・スタッフの文は全てエスケープする(答えに `<script>` があっても動かない)。
 */

export interface AiCompareReport {
  tenantSlug: string;
  generatedAt: Date;
  timeZone: string;
  models: readonly string[];
  runs: number;
  thinkingBudget: number | undefined;
  rebuild: boolean;
  blind: boolean;
  /** 隠したラベルの並べ替えの種(同じ種なら同じ並び。テストで決まった並びにする)。 */
  blindSeed: string;
  cases: readonly ComparisonCase[];
  results: readonly ComparisonCallResult[];
  skipped: readonly ComparisonSkip[];
  missingIds: readonly string[];
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML の本文・属性に入れる文字列をエスケープする。 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] as string);
}

/** 文字列の 32bit のハッシュ(FNV-1a。並べ替えの種)。 */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 種から決まる乱数(mulberry32)。 */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 種と件ごとの ID から決まる並べ替え(Fisher-Yates)。 */
export function seededShuffle<T>(items: readonly T[], seed: string, key: string): T[] {
  const random = seededRandom(hash32(`${seed}:${key}`));
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/** 隠したラベルの文字(A, B, C …)。 */
const labelLetter = (index: number) => String.fromCharCode('A'.charCodeAt(0) + index);

/**
 * 件ごとの、モデル → 隠したラベル(A・B・C…)。モデルの並びを件ごとに種で並べ替えて、先頭から A・B・C… を付ける
 * (同じモデルの何回目かは同じラベル)。
 */
export function blindLabelsOf(models: readonly string[], seed: string, caseKey: string): Map<string, string> {
  const shuffled = seededShuffle(models, seed, caseKey);
  return new Map(shuffled.map((model, i) => [model, labelLetter(i)]));
}

const STATUS_LABELS: Record<ComparisonUsedKeyword['status'], string> = {
  used: '使用(候補)',
  not_offered: '候補外',
  unknown: '表に無い',
};

const pre = (text: string) => `<div class="text">${escapeHtml(text)}</div>`;

function seconds(ms: number | null): string {
  return ms === null ? '-' : `${(ms / 1000).toFixed(1)}秒`;
}

function rate(part: number, whole: number): string {
  return whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%(${part}/${whole})`;
}

const rounded = (value: number | null) => (value === null ? '-' : String(Math.round(value)));

function keywordsHtml(items: readonly ComparisonUsedKeyword[]): string {
  if (items.length === 0) return '<p class="muted">使った語: なし</p>';
  const list = items
    .map(
      (k) =>
        `<li class="kw kw-${escapeHtml(k.status)}">${escapeHtml(k.code)}${k.keyword ? ` ${escapeHtml(k.keyword)}` : ''} <span class="badge">${escapeHtml(STATUS_LABELS[k.status])}</span></li>`,
    )
    .join('');
  return `<p class="label">使った語</p><ul class="kws">${list}</ul>`;
}

function draftHtml(draft: ComparisonDraft): string {
  const warnings =
    draft.warnings.length === 0
      ? '<p class="muted">注意: なし</p>'
      : `<p class="label">注意(warnings)</p><ul class="warnings">${draft.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
  const judged = [
    draft.psi !== undefined ? `PSI ${escapeHtml(draft.psi)}` : null,
    draft.eduLevel !== undefined ? `★${escapeHtml(draft.eduLevel)}` : null,
  ].filter((x) => x !== null);
  return [
    warnings,
    judged.length > 0 ? `<p class="muted">AI の判定: ${judged.join(' / ')}</p>` : '',
    '<p class="label">社内向け(internal)</p>',
    pre(draft.internal),
    '<p class="label">保護者向け(customer)</p>',
    pre(draft.customer),
  ].join('');
}

function tokensHtml(result: ComparisonCallResult): string {
  const u = result.usage;
  if (!u) return 'トークン: -';
  const value = (n: number | undefined) => (n === undefined ? '-' : String(n));
  return `トークン: 入力 ${value(u.promptTokens)} / 出力 ${value(u.candidatesTokens)} / 思考 ${value(u.thoughtsTokens)} / 計 ${value(u.totalTokens)}`;
}

function resultCellHtml(label: string, result: ComparisonCallResult | undefined): string {
  if (!result)
    return `<div class="col"><h4>${escapeHtml(label)}</h4><p class="muted">呼んでいません</p></div>`;
  const meta = `<p class="meta">${escapeHtml(seconds(result.latencyMs))} ・ ${escapeHtml(tokensHtml(result))}</p>`;
  if (!result.ok) {
    return `<div class="col failed"><h4>${escapeHtml(label)}</h4>${meta}<p class="error">失敗(${escapeHtml(result.errorCode)}): ${escapeHtml(result.errorMessage)}</p></div>`;
  }
  const shape = result.jsonValid
    ? '<p class="ok">JSON の形: スキーマどおり</p>'
    : `<p class="error">JSON の形が違います: ${escapeHtml(result.shapeIssues.join(', '))}</p>`;
  return `<div class="col"><h4>${escapeHtml(label)}</h4>${meta}${shape}${result.draft ? draftHtml(result.draft) : ''}${keywordsHtml(result.usedKeywords)}</div>`;
}

function originalCellHtml(testCase: ComparisonCase, blind: boolean): string {
  const o = testCase.original;
  const model = blind ? '' : `(${o.model ?? 'モデル不明'})`;
  const head = `<h4>当時の出力${escapeHtml(model)}</h4><p class="meta">所要(参考・DB の読み込みを含む) ${escapeHtml(seconds(o.latencyMs))}</p>`;
  if (!o.draft) {
    return `<div class="col original failed">${head}<p class="error">当時は失敗(${escapeHtml(o.errorCode ?? '不明')})</p></div>`;
  }
  return `<div class="col original">${head}${draftHtml(o.draft)}${keywordsHtml(o.usedKeywords)}</div>`;
}

function savedCellHtml(testCase: ComparisonCase): string {
  if (!testCase.savedReport) return '';
  return `<div class="col saved"><h4>スタッフが保存した文</h4><p class="label">社内向け</p>${pre(testCase.savedReport.internalText)}<p class="label">保護者向け</p>${pre(testCase.savedReport.customerText)}</div>`;
}

function caseHeaderHtml(testCase: ComparisonCase, index: number): string {
  const age = testCase.childAgeMonths === null ? '不明' : formatChildAge(testCase.childAgeMonths);
  const psi = testCase.riskRating === null ? '未評価' : String(testCase.riskRating);
  const effective =
    testCase.effectiveEducationLevel === null ? '教育語なし' : `★${testCase.effectiveEducationLevel}`;
  const items = [
    `生成 ${testCase.generationId}`,
    `日付 ${testCase.businessDate}`,
    `月齢 ${age}`,
    `★${testCase.educationLevel}`,
    `調整後 ${effective}`,
    `PSI ${psi}`,
    ...(testCase.escalationRequired ? ['管理者へ連絡(PSI 1)'] : []),
    `候補の語 ${testCase.candidates.length}`,
  ];
  const rebuilt = testCase.rebuilt
    ? `<p class="muted">組み立て直したプロンプト: 月齢 ${escapeHtml(
        testCase.rebuilt.childAgeMonths === null ? '不明' : formatChildAge(testCase.rebuilt.childAgeMonths),
      )} ・ ★${escapeHtml(testCase.rebuilt.educationLevel)} ・ 調整後 ${escapeHtml(
        testCase.rebuilt.effectiveEducationLevel === null
          ? '教育語なし'
          : `★${testCase.rebuilt.effectiveEducationLevel}`,
      )} ・ 候補の語 ${escapeHtml(testCase.rebuilt.candidateCount)}</p>`
    : '';
  return [
    `<h3>${index + 1}. ${items.map(escapeHtml).join(' ・ ')}</h3>`,
    rebuilt,
    '<p class="label">スタッフのメモ</p>',
    pre(testCase.inputText),
    testCase.timeInfo ? `<p class="muted">時間: ${escapeHtml(testCase.timeInfo)}</p>` : '',
    `<details><summary>送ったプロンプト(${testCase.promptSource === 'rebuilt' ? '組み立て直し' : '当時のまま'})</summary>${pre(testCase.prompt)}</details>`,
  ].join('');
}

/** 件ごとの列のラベル(隠すときは A・B…、何回も送ったときは「・2回目」)。 */
function columnLabel(model: string, run: number, runs: number, labels: Map<string, string> | null): string {
  const name = labels ? (labels.get(model) ?? '?') : model;
  return runs > 1 ? `${name}・${run}回目` : name;
}

function caseHtml(report: AiCompareReport, testCase: ComparisonCase, index: number): string {
  const labels = report.blind ? blindLabelsOf(report.models, report.blindSeed, testCase.generationId) : null;
  const order = labels
    ? [...report.models].sort((a, b) => (labels.get(a) ?? '').localeCompare(labels.get(b) ?? ''))
    : [...report.models];
  const cells: string[] = [originalCellHtml(testCase, report.blind)];
  for (const model of order) {
    for (let run = 1; run <= report.runs; run++) {
      const result = report.results.find(
        (r) => r.generationId === testCase.generationId && r.model === model && r.run === run,
      );
      cells.push(resultCellHtml(columnLabel(model, run, report.runs, labels), result));
    }
  }
  cells.push(savedCellHtml(testCase));
  return `<section class="case">${caseHeaderHtml(testCase, index)}<div class="grid">${cells.join('')}</div></section>`;
}

function summaryHtml(summary: readonly ComparisonModelSummary[]): string {
  const rows = summary
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.model)}</td><td>${escapeHtml(rate(s.successes, s.calls))}</td><td>${escapeHtml(rate(s.jsonValid, s.calls))}</td><td>${escapeHtml(seconds(s.avgLatencyMs))}</td><td>${escapeHtml(rounded(s.avgPromptTokens))}</td><td>${escapeHtml(rounded(s.avgCandidatesTokens))}</td><td>${escapeHtml(rounded(s.avgThoughtsTokens))}</td><td>${escapeHtml(s.usedKeywords)}</td><td>${escapeHtml(s.notOffered)}</td><td>${escapeHtml(s.unknown)}</td></tr>`,
    )
    .join('');
  return `<table class="summary"><thead><tr><th>モデル</th><th>成功</th><th>JSON の形どおり</th><th>平均所要(成功)</th><th>平均トークン 入力</th><th>出力</th><th>思考</th><th>使った語(候補)</th><th>候補外</th><th>表に無い</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function blindMappingHtml(report: AiCompareReport): string {
  const rows = report.cases
    .map((testCase, i) => {
      const labels = blindLabelsOf(report.models, report.blindSeed, testCase.generationId);
      const pairs = [...labels]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([model, label]) => `${label} = ${model}`);
      return `<li>${i + 1}. ${escapeHtml(testCase.generationId)}: ${escapeHtml(pairs.join(' / '))}(当時の出力 = ${escapeHtml(testCase.original.model ?? '不明')})</li>`;
    })
    .join('');
  return `<details class="mapping"><summary>ラベルとモデルの対応(読み終えてから開く)</summary><ul>${rows}</ul></details>`;
}

const STYLE = `
body{font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;margin:16px;color:#1f2937;background:#f9fafb;font-size:14px;line-height:1.6}
h1{font-size:20px;margin:0 0 8px}h3{font-size:15px;margin:0 0 8px}h4{font-size:14px;margin:0 0 4px}
.notice{background:#fef3c7;border:1px solid #f59e0b;padding:8px 12px;border-radius:6px;margin:8px 0}
.case{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:16px 0}
.grid{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(300px,1fr);gap:12px;overflow-x:auto;margin-top:8px}
.col{border:1px solid #e5e7eb;border-radius:6px;padding:8px;background:#fff}
.col.original{background:#f3f4f6}.col.saved{background:#ecfdf5}.col.failed{background:#fef2f2}
.text{white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #f3f4f6;padding:6px;border-radius:4px}
.label{font-weight:600;margin:8px 0 2px}.muted{color:#6b7280;margin:4px 0}.meta{color:#4b5563;font-size:12px;margin:0 0 4px}
.error{color:#b91c1c}.ok{color:#047857;margin:4px 0}
.kws{margin:0;padding-left:18px}.kw-not_offered,.kw-unknown{color:#6b7280}
.badge{font-size:11px;border:1px solid #d1d5db;border-radius:4px;padding:0 4px}
.warnings{margin:0;padding-left:18px;color:#92400e}
table.summary{border-collapse:collapse;background:#fff;margin:8px 0}
table.summary th,table.summary td{border:1px solid #d1d5db;padding:4px 8px;text-align:left}
details{margin:6px 0}summary{cursor:pointer;color:#1d4ed8}
`;

/** 比較の結果の HTML(1ファイルで完結する)。 */
export function renderAiCompareHtml(report: AiCompareReport): string {
  const summary = summarizeReportAiComparison(report.models, report.results);
  const conditions = [
    `テナント ${report.tenantSlug}`,
    `作成 ${report.generatedAt.toISOString()}(タイムゾーン ${report.timeZone})`,
    `モデル ${report.blind ? `${report.models.length}つ(隠しています)` : report.models.join(', ')}`,
    `回数 ${report.runs}`,
    `思考の量 ${report.thinkingBudget === undefined ? 'モデルの既定' : report.thinkingBudget}`,
    `プロンプト ${report.rebuild ? '今の設定で組み立て直し' : '当時のまま'}`,
    `件数 ${report.cases.length}`,
  ];
  const skipped =
    report.skipped.length + report.missingIds.length === 0
      ? ''
      : `<details open><summary>比べなかった生成(${report.skipped.length + report.missingIds.length}件)</summary><ul>${[
          ...report.skipped.map((s) => `<li>${escapeHtml(s.generationId)}: ${escapeHtml(s.reason)}</li>`),
          ...report.missingIds.map((id) => `<li>${escapeHtml(id)}: 生成の記録が見つかりません</li>`),
        ].join('')}</ul></details>`;
  const summarySection = report.blind
    ? `<details><summary>モデルごとのまとめ(開くとモデル名が見えます)</summary>${summaryHtml(summary)}</details>`
    : summaryHtml(summary);
  return [
    '<!DOCTYPE html>',
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(`日報AIのモデル比較 ${report.tenantSlug}`)}</title>`,
    `<style>${STYLE}</style></head><body>`,
    '<h1>日報AIのモデル比較</h1>',
    '<p class="notice">このファイルにはテナントのデータ(メモ・日報の文)が含まれます。審査の担当者の外に渡さず、リポジトリにも入れないでください。</p>',
    `<p class="muted">${conditions.map(escapeHtml).join(' ・ ')}</p>`,
    summarySection,
    skipped,
    ...report.cases.map((testCase, i) => caseHtml(report, testCase, i)),
    report.blind ? blindMappingHtml(report) : '',
    '</body></html>',
  ].join('\n');
}
