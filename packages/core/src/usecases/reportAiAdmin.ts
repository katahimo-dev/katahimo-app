import {
  REPORT_AI_MASTER_KINDS,
  type ReportAgeBandInput,
  type ReportAiImportCount,
  type ReportAiImportIssue,
  type ReportAiImportResponse,
  type ReportAiMasterKind,
} from '@katahimo/shared';
import {
  addIsoDays,
  conflict,
  DomainError,
  invalid,
  newId,
  type ParsedReportAiImport,
  zonedDayRange,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type {
  ReportAiLevelTable,
  ReportAiLevelTypes,
  ReportAiMasterRecords,
  ReportAiRowMeta,
  ReportAiRowTable,
  ReportAiRowTypes,
} from '../ports/reportAi';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor, Clock } from './requestMeta';

/**
 * 管理画面「日報AIの調整」(管理者だけ。ルートが requireAdmin で確かめる)。マスターの一覧・行ごとの編集
 * (row_version で 409)・xlsx の取込(先に確かめてから1つのトランザクションで反映)・書き出し・キーワードの利用状況。
 */
export interface ReportAiAdminDeps extends Clock {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

const TABLE_LABELS: Record<ReportAiRowTable | ReportAiLevelTable, string> = {
  keywords: 'キーワード',
  ageBands: '年齢帯',
  phrases: '表現',
  stanceRules: '見ていた人スタンス',
  educationLevels: '教育思考★',
  psiLevels: 'PSI',
};

/** 取込の突き合わせ・重複の確かめに使う、行の自然キー。 */
export function naturalKeyOf<T extends ReportAiRowTable>(table: T, value: ReportAiRowTypes[T]): string {
  switch (table) {
    case 'keywords':
      return (value as ReportAiRowTypes['keywords']).code;
    case 'ageBands':
      return (value as ReportAiRowTypes['ageBands']).label;
    case 'phrases': {
      const p = value as ReportAiRowTypes['phrases'];
      return `${p.kind}:${p.body}`;
    }
    default:
      return (value as ReportAiRowTypes['stanceRules']).topic;
  }
}

export async function listReportAiMasters(
  deps: ReportAiAdminDeps,
  actor: Actor,
): Promise<ReportAiMasterRecords> {
  return deps.uow.run(actor.tenantId, (r) => r.reportAi.listRecords());
}

/** アーカイブしていない年齢帯の月齢範囲が重なっていれば、その組の説明(重なりが無ければ null)。 */
export function findAgeBandOverlap(
  bands: readonly Pick<ReportAgeBandInput, 'label' | 'ageFromMonths' | 'ageToMonths'>[],
): string | null {
  const sorted = [...bands].sort((a, b) => a.ageFromMonths - b.ageFromMonths);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.ageFromMonths < prev.ageToMonths) {
      return `年齢帯「${prev.label}」と「${cur.label}」の月齢範囲が重なっています`;
    }
  }
  return null;
}

async function assertNoAgeBandOverlap(r: TenantRepositories): Promise<void> {
  const { ageBands } = await r.reportAi.listRecords();
  const overlap = findAgeBandOverlap(ageBands);
  if (overlap) throw invalid(overlap, { ageFromMonths: overlap }, 'age_band_overlap');
}

async function logRejected(
  deps: ReportAiAdminDeps,
  actor: Actor,
  action: string,
  error: unknown,
  details: object,
) {
  if (!(error instanceof DomainError)) return;
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'WARN',
    action,
    actorStaffId: actor.staffId,
    details: { ...details, reason: error.reason ?? error.code },
    ...actor.meta,
  });
}

/**
 * 行を足す(id が null)か書き換える。自然キー(キーワードID・年齢帯・区分+表現・項目)が他の行と重なれば 409。
 * 年齢帯は書いたあとの全ての帯で月齢範囲が重ならないことを確かめる(重なれば 400。同時の保存は DB の EXCLUDE 制約が
 * 止める)。
 */
export async function saveReportAiRow<T extends ReportAiRowTable>(
  deps: ReportAiAdminDeps,
  actor: Actor,
  table: T,
  id: string | null,
  value: ReportAiRowTypes[T],
  rowVersion?: number,
): Promise<ReportAiRowMeta> {
  try {
    const saved = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const sameKey = await r.reportAi.findRowByKey(table, naturalKeyOf(table, value));
        if (sameKey && sameKey.id !== id && !sameKey.archived) {
          throw conflict(
            `同じ${table === 'keywords' ? 'ID' : table === 'phrases' ? '表現' : table === 'ageBands' ? '年齢帯' : '項目'}の${TABLE_LABELS[table]}が既にあります`,
            undefined,
            'duplicate_key',
          );
        }
        let meta: ReportAiRowMeta;
        if (id) {
          meta = await r.reportAi.updateRow(table, id, value, actor.staffId, rowVersion);
        } else if (sameKey?.archived) {
          // アーカイブした行と同じキーで足したときは、その行を戻して書き換える(キーの一意制約のため)
          meta = await r.reportAi.updateRow(table, sameKey.id, value, actor.staffId);
        } else {
          meta = await r.reportAi.insertRow(table, newId(), value, actor.staffId);
        }
        if (table === 'ageBands') await assertNoAgeBandOverlap(r);
        return meta;
      },
      { actorId: actor.staffId },
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'INFO',
      action: 'settings.report_ai.row_saved',
      actorStaffId: actor.staffId,
      details: { table, id: saved.id, mode: id ? 'update' : 'create' },
      ...actor.meta,
    });
    return saved;
  } catch (error) {
    await logRejected(deps, actor, 'settings.report_ai.save_rejected', error, { table, id });
    throw error;
  }
}

/** 行をアーカイブする(プロンプトに使わなくなる。同じキーで足す・取り込むと戻る)。 */
export async function archiveReportAiRow(
  deps: ReportAiAdminDeps,
  actor: Actor,
  table: ReportAiRowTable,
  id: string,
  rowVersion?: number,
): Promise<void> {
  try {
    await deps.uow.run(actor.tenantId, (r) => r.reportAi.archiveRow(table, id, actor.staffId, rowVersion), {
      actorId: actor.staffId,
    });
  } catch (error) {
    await logRejected(deps, actor, 'settings.report_ai.save_rejected', error, { table, id });
    throw error;
  }
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'settings.report_ai.row_archived',
    actorStaffId: actor.staffId,
    details: { table, id },
    ...actor.meta,
  });
}

/** 段階(★1〜5・PSI 5〜1)の行を書く(無ければ作る)。 */
export async function saveReportAiLevel<T extends ReportAiLevelTable>(
  deps: ReportAiAdminDeps,
  actor: Actor,
  table: T,
  value: ReportAiLevelTypes[T],
  rowVersion?: number,
): Promise<ReportAiRowMeta> {
  try {
    const saved = await deps.uow.run(
      actor.tenantId,
      (r) => r.reportAi.upsertLevel(table, newId(), value, actor.staffId, rowVersion),
      { actorId: actor.staffId },
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'INFO',
      action: 'settings.report_ai.row_saved',
      actorStaffId: actor.staffId,
      details: { table, id: saved.id, level: value.level, mode: 'upsert' },
      ...actor.meta,
    });
    return saved;
  } catch (error) {
    await logRejected(deps, actor, 'settings.report_ai.save_rejected', error, { table, level: value.level });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// 取込(xlsx → マスター)
// ─────────────────────────────────────────────────────────────

/** 値を比べる(キーの順に依らない)。 */
function sameValue(a: unknown, b: unknown): boolean {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, val]) => [k, stable(val)]),
          )
        : v;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

const emptyCounts = (): Record<ReportAiMasterKind, ReportAiImportCount> =>
  Object.fromEntries(
    REPORT_AI_MASTER_KINDS.map((k) => [k, { rows: 0, created: 0, updated: 0, unchanged: 0 }]),
  ) as Record<ReportAiMasterKind, ReportAiImportCount>;

/**
 * 取込の中身を DB に当てる(write=false なら数えるだけ)。自然キーで突き合わせ、同じ値なら何もしない、違えば
 * 書き換える(アーカイブされていれば戻す)、無ければ足す。ファイルに無い既存の行は消さない(マージ)。
 */
async function applyImport(
  r: TenantRepositories,
  parsed: ParsedReportAiImport,
  staffId: string,
  write: boolean,
): Promise<Record<ReportAiMasterKind, ReportAiImportCount>> {
  const counts = emptyCounts();
  const rowTables: ReportAiRowTable[] = ['ageBands', 'keywords', 'phrases', 'stanceRules'];
  for (const table of rowTables) {
    const values = parsed[table] as ReportAiRowTypes[typeof table][];
    counts[table].rows = values.length;
    for (const value of values) {
      const existing = await r.reportAi.findRowByKey(table, naturalKeyOf(table, value));
      if (!existing) {
        counts[table].created++;
        if (write) await r.reportAi.insertRow(table, newId(), value, staffId);
      } else if (!existing.archived && sameValue(existing.value, value)) {
        counts[table].unchanged++;
      } else {
        counts[table].updated++;
        if (write) await r.reportAi.updateRow(table, existing.id, value, staffId);
      }
    }
  }
  const current = await r.reportAi.listRecords();
  const levelTables: ReportAiLevelTable[] = ['educationLevels', 'psiLevels'];
  for (const table of levelTables) {
    const values = parsed[table] as ReportAiLevelTypes[typeof table][];
    counts[table].rows = values.length;
    for (const value of values) {
      const existing = (current[table] as (ReportAiLevelTypes[typeof table] & ReportAiRowMeta)[]).find(
        (row) => row.level === value.level,
      );
      if (existing) {
        const { id: _id, rowVersion: _v, updatedAt: _u, ...stored } = existing;
        if (sameValue(stored, value)) {
          counts[table].unchanged++;
          continue;
        }
        counts[table].updated++;
      } else {
        counts[table].created++;
      }
      if (write) await r.reportAi.upsertLevel(table, newId(), value, staffId);
    }
  }
  return counts;
}

/** 取込後の姿(既存 + 今回)で確かめる: 年齢帯の月齢範囲の重なり(誤り)、年齢帯の相性の良いキーワードID(知らせ)。 */
function checkMergedState(
  current: ReportAiMasterRecords,
  parsed: ParsedReportAiImport,
): { errors: ReportAiImportIssue[]; warnings: ReportAiImportIssue[] } {
  const bands = new Map(current.ageBands.map((b) => [b.label, b as ReportAgeBandInput]));
  for (const b of parsed.ageBands) bands.set(b.label, b);
  const errors: ReportAiImportIssue[] = [];
  const warnings: ReportAiImportIssue[] = [];
  const overlap = findAgeBandOverlap([...bands.values()]);
  if (overlap) errors.push({ sheet: '年齢帯', row: null, message: overlap });
  const codes = new Set([...current.keywords.map((k) => k.code), ...parsed.keywords.map((k) => k.code)]);
  for (const band of parsed.ageBands) {
    const unknown = band.keywordCodes.filter((c) => !codes.has(c.toUpperCase()));
    if (unknown.length > 0) {
      warnings.push({
        sheet: '年齢帯',
        row: null,
        message: `年齢帯「${band.label}」の相性の良いキーワードID ${unknown.join(' ')} はキーワードの表にありません`,
      });
    }
  }
  return { errors, warnings };
}

export interface ImportReportAiInput {
  parsed: ParsedReportAiImport;
  dryRun: boolean;
  fileName: string | null;
}

/**
 * xlsx の取込。dryRun は件数と誤りを返すだけ(何も書かない)。反映は誤りが1つも無いときだけ、全ての表を1つの
 * トランザクションで書き、import_runs(source = report_ai_xlsx)に件数を残す(途中で失敗すれば何も残らない)。
 */
export async function importReportAiMasters(
  deps: ReportAiAdminDeps,
  actor: Actor,
  input: ImportReportAiInput,
): Promise<ReportAiImportResponse> {
  const { parsed } = input;
  const preview = await deps.uow.run(actor.tenantId, async (r) => {
    const current = await r.reportAi.listRecords();
    const merged = checkMergedState(current, parsed);
    const counts = await applyImport(r, parsed, actor.staffId, false);
    return { counts, ...merged };
  });
  const errors = [...parsed.errors, ...preview.errors];
  const warnings = [...parsed.warnings, ...preview.warnings];
  if (input.dryRun || errors.length > 0) {
    if (!input.dryRun) {
      await deps.appLog.write({
        tenantId: actor.tenantId,
        level: 'WARN',
        action: 'settings.report_ai.import_rejected',
        actorStaffId: actor.staffId,
        details: { errors: errors.length },
        ...actor.meta,
      });
    }
    return { dryRun: input.dryRun, applied: false, counts: preview.counts, errors, warnings };
  }
  const runId = newId();
  const counts = await deps.uow.run(
    actor.tenantId,
    async (r) => {
      await r.importRuns.start({
        id: runId,
        source: 'report_ai_xlsx',
        fileName: input.fileName,
        fileVersion: null,
        triggeredBy: actor.staffId,
      });
      const applied = await applyImport(r, parsed, actor.staffId, true);
      await assertNoAgeBandOverlap(r);
      await r.importRuns.finish(runId, {
        status: 'applied',
        counts: flattenCounts(applied),
        message: warnings.length > 0 ? `知らせ ${warnings.length} 件` : null,
      });
      return applied;
    },
    { actorId: actor.staffId },
  );
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'settings.report_ai.imported',
    actorStaffId: actor.staffId,
    details: { importRunId: runId, ...flattenCounts(counts), warnings: warnings.length },
    ...actor.meta,
  });
  return { dryRun: false, applied: true, counts, errors: [], warnings };
}

function flattenCounts(counts: Record<ReportAiMasterKind, ReportAiImportCount>): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [kind, c] of Object.entries(counts)) {
    flat[`${kind}_created`] = c.created;
    flat[`${kind}_updated`] = c.updated;
    flat[`${kind}_unchanged`] = c.unchanged;
  }
  return flat;
}

/** 書き出し(取込と同じ形の xlsx。API が作る)の中身。書き出したことを残す。 */
export async function exportReportAiMasters(
  deps: ReportAiAdminDeps,
  actor: Actor,
): Promise<ReportAiMasterRecords> {
  const records = await deps.uow.run(actor.tenantId, (r) => r.reportAi.listRecords());
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'settings.report_ai.exported',
    actorStaffId: actor.staffId,
    details: { keywords: records.keywords.length, ageBands: records.ageBands.length },
    ...actor.meta,
  });
  return records;
}

export interface KeywordUsageCsvRow {
  code: string;
  keyword: string;
  category: string | null;
  candidateCount: number;
  usedCount: number;
}

/**
 * 教育キーワードの利用状況(期間の AI 生成で候補に出した回数・AI が使ったと答えた回数)。期間は業務日の両端を含む
 * (テナントのタイムゾーン)。アーカイブした語も数える(期間の途中で外した語)。
 */
export async function reportAiKeywordUsage(
  deps: ReportAiAdminDeps,
  actor: Actor,
  range: { from: string; to: string },
): Promise<KeywordUsageCsvRow[]> {
  const rows = await deps.uow.run(actor.tenantId, async (r) => {
    const tenant = await r.tenant();
    const from = zonedDayRange(range.from, tenant.timezone).from;
    const to = zonedDayRange(addIsoDays(range.to, 1), tenant.timezone).from;
    const usage = await r.reportAiGenerations.keywordUsage(from, to);
    const { keywords } = await r.reportAi.listRecords();
    const byId = new Map(keywords.map((k) => [k.id, k]));
    const result: KeywordUsageCsvRow[] = [];
    for (const u of usage) {
      const keyword = byId.get(u.keywordId);
      result.push({
        code: keyword?.code ?? '(アーカイブ済み)',
        keyword: keyword?.keyword ?? '',
        category: keyword?.category ?? null,
        candidateCount: u.candidateCount,
        usedCount: u.usedCount,
      });
    }
    // 候補に一度も出なかった語も0回として並べる
    for (const k of keywords) {
      if (!usage.some((u) => u.keywordId === k.id)) {
        result.push({
          code: k.code,
          keyword: k.keyword,
          category: k.category,
          candidateCount: 0,
          usedCount: 0,
        });
      }
    }
    return result.sort((a, b) => a.code.localeCompare(b.code));
  });
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'settings.report_ai.usage_exported',
    actorStaffId: actor.staffId,
    details: { from: range.from, to: range.to, rows: rows.length },
    ...actor.meta,
  });
  return rows;
}
