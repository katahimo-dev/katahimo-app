import {
  conflict,
  notFound,
  type ReportAiMasters,
  type ReportKeywordEntry,
  STALE_WRITE_MESSAGE,
} from '@katahimo/core/domain';
import type {
  CustomerReportProfileRecord,
  CustomerReportProfileRepository,
  ReportAiComparisonFilter,
  ReportAiComparisonSource,
  ReportAiGenerationInput,
  ReportAiGenerationRecord,
  ReportAiGenerationRepository,
  ReportAiLevelTable,
  ReportAiLevelTypes,
  ReportAiMasterRecords,
  ReportAiMasterRepository,
  ReportAiRowMeta,
  ReportAiRowTable,
  ReportAiRowTypes,
  ReportKeywordUsageRow,
} from '@katahimo/core/ports';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  customerReportProfiles,
  reportAgeBands,
  reportAiGenerations,
  reportEducationLevels,
  reportKeywords,
  reportPhrases,
  reportPsiLevels,
  reportStanceRules,
} from '../../schema';
import { TenantBound } from './base';

/** 表ごとの値の列(契約の *Input と同じ名前)。 */
const KEYWORD_FIELDS = [
  'code',
  'category',
  'keyword',
  'subConcept',
  'ageLabel',
  'ageFromMonths',
  'ageToMonths',
  'ageBandLabel',
  'educationLevelMin',
  'educationLevelMax',
  'psiMin',
  'tone',
  'parentExplanation',
  'phraseExamples',
  'usageScene',
  'ngExample',
  'sortOrder',
] as const;
const AGE_BAND_FIELDS = [
  'label',
  'ageFromMonths',
  'ageToMonths',
  'behaviorWords',
  'developmentTopics',
  'keywordCodes',
  'sceneExamples',
  'sortOrder',
] as const;
const PHRASE_FIELDS = ['kind', 'body', 'message', 'psiMin', 'psiMax', 'note', 'sortOrder'] as const;
const STANCE_FIELDS = ['topic', 'avoidText', 'recommendedText', 'reason', 'sortOrder'] as const;
const EDUCATION_LEVEL_FIELDS = [
  'level',
  'label',
  'customerProfile',
  'usage',
  'wordScope',
  'termNameRule',
  'termNamePolicy',
  'keywordsMin',
  'keywordsMax',
  'toneFocus',
  'exampleDirection',
] as const;
const PSI_LEVEL_FIELDS = ['level', 'label', 'criteria'] as const;

/** 行を持つ表(マスターの6表)の共通の列。 */
type MasterTable = PgTable & {
  tenantId: PgColumn;
  id: PgColumn;
  rowVersion: PgColumn;
  updatedAt: PgColumn;
  updatedBy: PgColumn;
};
type ArchivableTable = MasterTable & { archivedAt: PgColumn };

interface TableSpec {
  table: MasterTable;
  fields: readonly string[];
  /** 並び。 */
  order: PgColumn[];
  /**
   * 自然キーの一意制約の列(INSERT … ON CONFLICT の対象。指定しないと年齢帯の EXCLUDE 制約(DEFERRABLE)も
   * 対象になり PostgreSQL が受け付けない)。
   */
  conflictTarget: PgColumn[];
}

const ROW_TABLES: Record<
  ReportAiRowTable,
  TableSpec & { table: ArchivableTable; key: (key: string) => SQL }
> = {
  keywords: {
    table: reportKeywords,
    fields: KEYWORD_FIELDS,
    order: [reportKeywords.sortOrder, reportKeywords.code],
    conflictTarget: [reportKeywords.tenantId, reportKeywords.code],
    key: (key) => eq(reportKeywords.code, key),
  },
  ageBands: {
    table: reportAgeBands,
    fields: AGE_BAND_FIELDS,
    order: [reportAgeBands.sortOrder, reportAgeBands.ageFromMonths],
    conflictTarget: [reportAgeBands.tenantId, reportAgeBands.label],
    key: (key) => eq(reportAgeBands.label, key),
  },
  phrases: {
    table: reportPhrases,
    fields: PHRASE_FIELDS,
    order: [reportPhrases.kind, reportPhrases.sortOrder, reportPhrases.body],
    conflictTarget: [reportPhrases.tenantId, reportPhrases.kind, reportPhrases.body],
    key: (key) => {
      const separator = key.indexOf(':');
      return and(
        eq(reportPhrases.kind, key.slice(0, separator) as 'warm' | 'avoid'),
        eq(reportPhrases.body, key.slice(separator + 1)),
      ) as SQL;
    },
  },
  stanceRules: {
    table: reportStanceRules,
    fields: STANCE_FIELDS,
    order: [reportStanceRules.sortOrder, reportStanceRules.topic],
    conflictTarget: [reportStanceRules.tenantId, reportStanceRules.topic],
    key: (key) => eq(reportStanceRules.topic, key),
  },
};

const LEVEL_TABLES: Record<ReportAiLevelTable, TableSpec & { level: PgColumn }> = {
  educationLevels: {
    table: reportEducationLevels,
    fields: EDUCATION_LEVEL_FIELDS,
    order: [reportEducationLevels.level],
    conflictTarget: [reportEducationLevels.tenantId, reportEducationLevels.level],
    level: reportEducationLevels.level,
  },
  psiLevels: {
    table: reportPsiLevels,
    fields: PSI_LEVEL_FIELDS,
    order: [reportPsiLevels.level],
    conflictTarget: [reportPsiLevels.tenantId, reportPsiLevels.level],
    level: reportPsiLevels.level,
  },
};

function columnsOf(spec: TableSpec) {
  const table = spec.table as unknown as Record<string, PgColumn>;
  const columns: Record<string, PgColumn> = {};
  for (const field of spec.fields) columns[field] = table[field] as PgColumn;
  return columns;
}

function metaColumns(spec: TableSpec) {
  return { id: spec.table.id, rowVersion: spec.table.rowVersion, updatedAt: spec.table.updatedAt };
}

/** 値から表の列の値だけを取り出す(書き込み)。 */
function valuesOf(spec: TableSpec, value: object): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  return Object.fromEntries(spec.fields.map((f) => [f, source[f] ?? null]));
}

/**
 * 日報AIの調整のマスター。行は消さずに archived_at でプロンプトから外す。
 * 年齢帯の月齢範囲の重なりは EXCLUDE 制約(コミットのときに確かめる)が止める。
 */
export class DrizzleReportAiMasterRepository extends TenantBound implements ReportAiMasterRepository {
  private async activeRows(spec: TableSpec, archivable: boolean) {
    const table = spec.table as ArchivableTable;
    return this.tx
      .select({ ...metaColumns(spec), ...columnsOf(spec) })
      .from(spec.table)
      .where(and(eq(table.tenantId, this.tenantId), archivable ? isNull(table.archivedAt) : undefined))
      .orderBy(...spec.order.map((c) => asc(c)));
  }

  async listRecords(): Promise<ReportAiMasterRecords> {
    const [keywords, ageBands, phrases, stanceRules, educationLevels, psiLevels] = await Promise.all([
      this.activeRows(ROW_TABLES.keywords, true),
      this.activeRows(ROW_TABLES.ageBands, true),
      this.activeRows(ROW_TABLES.phrases, true),
      this.activeRows(ROW_TABLES.stanceRules, true),
      this.activeRows(LEVEL_TABLES.educationLevels, false),
      this.activeRows(LEVEL_TABLES.psiLevels, false),
    ]);
    return {
      keywords,
      ageBands,
      educationLevels,
      psiLevels,
      phrases,
      stanceRules,
    } as unknown as ReportAiMasterRecords;
  }

  async loadActive(): Promise<ReportAiMasters> {
    const records = await this.listRecords();
    const strip = <T extends { rowVersion: number; updatedAt: Date }>({
      rowVersion: _v,
      updatedAt: _u,
      ...rest
    }: T) => rest;
    return {
      keywords: records.keywords.map(strip),
      ageBands: records.ageBands.map(strip),
      phrases: records.phrases.map(strip),
      stanceRules: records.stanceRules.map(strip),
      educationLevels: records.educationLevels.map(({ id: _id, ...rest }) => strip(rest)),
      psiLevels: records.psiLevels.map(({ id: _id, ...rest }) => strip(rest)),
    };
  }

  async findKeywordsByIds(ids: readonly string[]): Promise<ReportKeywordEntry[]> {
    if (ids.length === 0) return [];
    const spec = ROW_TABLES.keywords;
    const rows = (await this.tx
      .select({ id: reportKeywords.id, ...columnsOf(spec) })
      .from(reportKeywords)
      .where(
        and(eq(reportKeywords.tenantId, this.tenantId), inArray(reportKeywords.id, [...ids])),
      )) as unknown as ReportKeywordEntry[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  async findRowByKey<T extends ReportAiRowTable>(
    table: T,
    key: string,
  ): Promise<{ id: string; rowVersion: number; archived: boolean; value: ReportAiRowTypes[T] } | null> {
    const spec = ROW_TABLES[table];
    const rows = await this.tx
      .select({ ...metaColumns(spec), archivedAt: spec.table.archivedAt, ...columnsOf(spec) })
      .from(spec.table)
      .where(and(eq(spec.table.tenantId, this.tenantId), spec.key(key)));
    const row = rows[0] as
      | (Record<string, unknown> & { id: string; rowVersion: number; archivedAt: Date | null })
      | undefined;
    if (!row) return null;
    const { id, rowVersion, archivedAt, updatedAt: _u, ...value } = row;
    return { id, rowVersion, archived: archivedAt !== null, value: value as ReportAiRowTypes[T] };
  }

  async insertRow<T extends ReportAiRowTable>(
    table: T,
    id: string,
    value: ReportAiRowTypes[T],
    updatedBy: string,
  ): Promise<ReportAiRowMeta> {
    const spec = ROW_TABLES[table];
    const rows = await this.tx
      .insert(spec.table)
      .values({ tenantId: this.tenantId, id, updatedBy, ...valuesOf(spec, value) } as never)
      .onConflictDoNothing({ target: spec.conflictTarget })
      .returning(metaColumns(spec));
    const row = rows[0] as ReportAiRowMeta | undefined;
    if (!row)
      throw conflict('同じキーの行が既にあります。画面を開きなおしてください', undefined, 'duplicate_key');
    return row;
  }

  async updateRow<T extends ReportAiRowTable>(
    table: T,
    id: string,
    value: ReportAiRowTypes[T],
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<ReportAiRowMeta> {
    const spec = ROW_TABLES[table];
    return this.writeVersioned(
      spec,
      id,
      { ...valuesOf(spec, value), archivedAt: null, updatedBy },
      expectedVersion,
    );
  }

  async archiveRow(
    table: ReportAiRowTable,
    id: string,
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<void> {
    await this.writeVersioned(ROW_TABLES[table], id, { archivedAt: new Date(), updatedBy }, expectedVersion);
  }

  /** 版を確かめて書く(無ければ not_found、版が違えば conflict)。 */
  private async writeVersioned(
    spec: TableSpec,
    id: string,
    set: Record<string, unknown>,
    expectedVersion: number | undefined,
  ): Promise<ReportAiRowMeta> {
    const t = spec.table;
    const rows = await this.tx
      .update(t)
      .set({ ...set, rowVersion: sql`${t.rowVersion} + 1` } as never)
      .where(
        and(
          eq(t.tenantId, this.tenantId),
          eq(t.id, id),
          expectedVersion === undefined ? undefined : eq(t.rowVersion, expectedVersion),
        ),
      )
      .returning(metaColumns(spec));
    const row = rows[0] as ReportAiRowMeta | undefined;
    if (row) return row;
    const exists = await this.tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.tenantId, this.tenantId), eq(t.id, id)));
    if (exists.length === 0)
      throw notFound('行が見つかりません。画面を開きなおしてください', 'row_not_found');
    throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
  }

  async upsertLevel<T extends ReportAiLevelTable>(
    table: T,
    id: string,
    value: ReportAiLevelTypes[T],
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<ReportAiRowMeta> {
    const spec = LEVEL_TABLES[table];
    const t = spec.table;
    const existing = await this.tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.tenantId, this.tenantId), eq(spec.level, value.level)));
    const current = existing[0] as { id: string } | undefined;
    if (current)
      return this.writeVersioned(spec, current.id, { ...valuesOf(spec, value), updatedBy }, expectedVersion);
    if (expectedVersion !== undefined) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    const rows = await this.tx
      .insert(t)
      .values({ tenantId: this.tenantId, id, updatedBy, ...valuesOf(spec, value) } as never)
      .onConflictDoNothing({ target: spec.conflictTarget })
      .returning(metaColumns(spec));
    const row = rows[0] as ReportAiRowMeta | undefined;
    if (!row) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    return row;
  }
}

const profileColumns = {
  customerId: customerReportProfiles.customerId,
  educationLevel: customerReportProfiles.educationLevel,
  rowVersion: customerReportProfiles.rowVersion,
  updatedAt: customerReportProfiles.updatedAt,
  updatedBy: customerReportProfiles.updatedBy,
};

/** 家庭ごとの教育思考★。 */
export class DrizzleCustomerReportProfileRepository
  extends TenantBound
  implements CustomerReportProfileRepository
{
  async find(customerId: string): Promise<CustomerReportProfileRecord | null> {
    const rows = await this.tx
      .select(profileColumns)
      .from(customerReportProfiles)
      .where(
        and(
          eq(customerReportProfiles.tenantId, this.tenantId),
          eq(customerReportProfiles.customerId, customerId),
        ),
      );
    return rows[0] ?? null;
  }

  async save(
    customerId: string,
    educationLevel: number | null,
    updatedBy: string,
    expectedVersion: number | undefined,
  ): Promise<CustomerReportProfileRecord> {
    if (expectedVersion === undefined) {
      // 未設定の家庭に初めて付ける(同時に付けた人がいれば、後の人は conflict)
      const [row] = await this.tx
        .insert(customerReportProfiles)
        .values({ tenantId: this.tenantId, customerId, educationLevel, updatedBy })
        .onConflictDoNothing()
        .returning(profileColumns);
      if (!row) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
      return row;
    }
    const [row] = await this.tx
      .update(customerReportProfiles)
      .set({ educationLevel, updatedBy, rowVersion: sql`${customerReportProfiles.rowVersion} + 1` })
      .where(
        and(
          eq(customerReportProfiles.tenantId, this.tenantId),
          eq(customerReportProfiles.customerId, customerId),
          eq(customerReportProfiles.rowVersion, expectedVersion),
        ),
      )
      .returning(profileColumns);
    if (!row) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    return row;
  }
}

const generationColumns = {
  id: reportAiGenerations.id,
  staffId: reportAiGenerations.staffId,
  customerId: reportAiGenerations.customerId,
  careRecipientId: reportAiGenerations.careRecipientId,
  careRecordId: reportAiGenerations.careRecordId,
  promptKey: reportAiGenerations.promptKey,
  promptRevision: reportAiGenerations.promptRevision,
  model: reportAiGenerations.model,
  riskRating: reportAiGenerations.riskRating,
  errorCode: reportAiGenerations.errorCode,
  createdAt: reportAiGenerations.createdAt,
};

/** AI 生成の記録(追記のみ。日報への結び付けだけ書き換える)。 */
export class DrizzleReportAiGenerationRepository extends TenantBound implements ReportAiGenerationRepository {
  async insert(input: ReportAiGenerationInput): Promise<void> {
    await this.tx.insert(reportAiGenerations).values({
      tenantId: this.tenantId,
      ...input,
      errorCode: input.errorCode as ReportAiGenerationRecord['errorCode'] as never,
    });
  }

  async findById(id: string): Promise<ReportAiGenerationRecord | null> {
    const rows = await this.tx
      .select(generationColumns)
      .from(reportAiGenerations)
      .where(and(eq(reportAiGenerations.tenantId, this.tenantId), eq(reportAiGenerations.id, id)));
    return rows[0] ?? null;
  }

  async linkToCareRecord(id: string, careRecordId: string): Promise<boolean> {
    const g = reportAiGenerations;
    // まだ結び付いていないか同じ日報のときだけ書く(並んだ2つの保存が同じ生成を別々の日報に結び付けない)
    const rows = await this.tx
      .update(g)
      .set({ careRecordId })
      .where(
        and(
          eq(g.tenantId, this.tenantId),
          eq(g.id, id),
          or(isNull(g.careRecordId), eq(g.careRecordId, careRecordId)),
        ),
      )
      .returning({ id: g.id });
    return rows.length > 0;
  }

  async listForComparison(filter: ReportAiComparisonFilter): Promise<ReportAiComparisonSource[]> {
    const g = reportAiGenerations;
    const selection = filter.ids
      ? inArray(g.id, [...filter.ids])
      : and(
          isNull(g.errorCode),
          isNotNull(g.output),
          filter.since ? gte(g.createdAt, filter.since) : undefined,
        );
    if (filter.ids && filter.ids.length === 0) return [];
    const rows = await this.tx
      .select({
        id: g.id,
        staffId: g.staffId,
        customerId: g.customerId,
        careRecipientId: g.careRecipientId,
        careRecordId: g.careRecordId,
        model: g.model,
        promptText: g.promptText,
        inputText: g.inputText,
        timeInfo: g.timeInfo,
        startedAt: g.startedAt,
        finishedAt: g.finishedAt,
        childAgeMonths: g.childAgeMonths,
        educationLevel: g.educationLevel,
        effectiveEducationLevel: g.effectiveEducationLevel,
        riskRating: g.riskRating,
        escalationRequired: g.escalationRequired,
        candidateKeywordIds: g.candidateKeywordIds,
        usedKeywordIds: g.usedKeywordIds,
        unresolvedUsedCodes: g.unresolvedUsedCodes,
        output: g.output,
        errorCode: g.errorCode,
        createdAt: g.createdAt,
      })
      .from(g)
      .where(and(eq(g.tenantId, this.tenantId), eq(g.promptKey, filter.promptKey), selection))
      .orderBy(desc(g.createdAt), desc(g.id))
      .limit(filter.limit);
    return rows;
  }

  async keywordUsage(from: Date, to: Date): Promise<ReportKeywordUsageRow[]> {
    const g = reportAiGenerations;
    const rows = await this.tx.execute<{
      keyword_id: string;
      candidate_count: number;
      used_count: number;
    }>(sql`
      with period as (
        select ${g.candidateKeywordIds} as candidates, ${g.usedKeywordIds} as used
        from ${g}
        where ${g.tenantId} = ${this.tenantId} and ${g.createdAt} >= ${from.toISOString()}::timestamptz
          and ${g.createdAt} < ${to.toISOString()}::timestamptz
      ),
      candidate as (select unnest(candidates) as keyword_id from period),
      used as (select unnest(used) as keyword_id from period)
      select k.keyword_id::text as keyword_id,
        (select count(*) from candidate c where c.keyword_id = k.keyword_id)::int as candidate_count,
        (select count(*) from used u where u.keyword_id = k.keyword_id)::int as used_count
      from (select keyword_id from candidate union select keyword_id from used) k`);
    return rows.map((r) => ({
      keywordId: r.keyword_id,
      candidateCount: Number(r.candidate_count),
      usedCount: Number(r.used_count),
    }));
  }

  async unresolvedAnswerUsage(from: Date, to: Date): Promise<{ answer: string; count: number }[]> {
    const g = reportAiGenerations;
    const rows = await this.tx.execute<{ answer: string; count: number }>(sql`
      select answer, count(*)::int as count
      from ${g}, unnest(${g.unresolvedUsedCodes}) as answer
      where ${g.tenantId} = ${this.tenantId} and ${g.createdAt} >= ${from.toISOString()}::timestamptz
        and ${g.createdAt} < ${to.toISOString()}::timestamptz
      group by answer`);
    return rows.map((r) => ({ answer: r.answer, count: Number(r.count) }));
  }
}
