/**
 * 日報AIの調整(マスター・家庭の★・AI 生成の記録)のインメモリ実装(testDoubles.ts の fakeRepositories が使う)。
 * DB と同じく、自然キーの重なり・版の違いは conflict、無い行は not_found にする。
 */
import { conflict, notFound, type ReportAiMasters, STALE_WRITE_MESSAGE } from '../domain';
import type {
  CustomerReportProfileRecord,
  CustomerReportProfileRepository,
  ReportAiGenerationInput,
  ReportAiGenerationRepository,
  ReportAiLevelTable,
  ReportAiLevelTypes,
  ReportAiMasterRecords,
  ReportAiMasterRepository,
  ReportAiRowMeta,
  ReportAiRowTable,
  ReportAiRowTypes,
} from '../ports/reportAi';
import { naturalKeyOf } from './reportAiAdmin';

type Stored<T> = T & ReportAiRowMeta & { archivedAt: Date | null; updatedBy: string | null };

export interface ReportAiFakeData {
  reportAi: {
    keywords: Stored<ReportAiRowTypes['keywords']>[];
    ageBands: Stored<ReportAiRowTypes['ageBands']>[];
    phrases: Stored<ReportAiRowTypes['phrases']>[];
    stanceRules: Stored<ReportAiRowTypes['stanceRules']>[];
    educationLevels: Stored<ReportAiLevelTypes['educationLevels']>[];
    psiLevels: Stored<ReportAiLevelTypes['psiLevels']>[];
  };
  customerReportProfiles: CustomerReportProfileRecord[];
  reportAiGenerations: (ReportAiGenerationInput & { careRecordId: string | null; createdAt: Date })[];
}

export function emptyReportAiFakeData(): ReportAiFakeData {
  return {
    reportAi: {
      keywords: [],
      ageBands: [],
      phrases: [],
      stanceRules: [],
      educationLevels: [],
      psiLevels: [],
    },
    customerReportProfiles: [],
    reportAiGenerations: [],
  };
}

/** 書くたびに進む時刻(並び・更新日時の確かめにだけ使う)。 */
let tick = 0;
const nextTime = () => new Date(Date.UTC(2026, 0, 1) + ++tick);

const meta = (row: ReportAiRowMeta): ReportAiRowMeta => ({
  id: row.id,
  rowVersion: row.rowVersion,
  updatedAt: row.updatedAt,
});

function strip<T>(row: Stored<T>): T & ReportAiRowMeta {
  const { archivedAt: _a, updatedBy: _u, ...rest } = structuredClone(row);
  return rest as T & ReportAiRowMeta;
}

export function fakeReportAiRepositories(d: () => ReportAiFakeData): {
  reportAi: ReportAiMasterRepository;
  customerReportProfiles: CustomerReportProfileRepository;
  reportAiGenerations: ReportAiGenerationRepository;
} {
  const rows = <T extends ReportAiRowTable>(table: T) =>
    d().reportAi[table] as unknown as Stored<ReportAiRowTypes[T]>[];
  const levels = <T extends ReportAiLevelTable>(table: T) =>
    d().reportAi[table] as unknown as Stored<ReportAiLevelTypes[T]>[];
  const byOrder = <T extends { sortOrder: number }>(list: T[]) =>
    [...list].sort((a, b) => a.sortOrder - b.sortOrder);

  const reportAi: ReportAiMasterRepository = {
    async listRecords(): Promise<ReportAiMasterRecords> {
      const active = <T extends { archivedAt: Date | null }>(list: T[]) => list.filter((r) => !r.archivedAt);
      return {
        keywords: byOrder(active(rows('keywords'))).map(strip),
        ageBands: byOrder(active(rows('ageBands'))).map(strip),
        phrases: byOrder(active(rows('phrases'))).map(strip),
        stanceRules: byOrder(active(rows('stanceRules'))).map(strip),
        educationLevels: [...levels('educationLevels')].sort((a, b) => a.level - b.level).map(strip),
        psiLevels: [...levels('psiLevels')].sort((a, b) => a.level - b.level).map(strip),
      };
    },
    async loadActive(): Promise<ReportAiMasters> {
      const records = await reportAi.listRecords();
      const noMeta = <T extends ReportAiRowMeta>({ rowVersion: _v, updatedAt: _u, ...rest }: T) => rest;
      return {
        keywords: records.keywords.map(noMeta),
        ageBands: records.ageBands.map(noMeta),
        phrases: records.phrases.map(noMeta),
        stanceRules: records.stanceRules.map(noMeta),
        educationLevels: records.educationLevels.map(
          ({ id: _id, rowVersion: _v, updatedAt: _u, ...rest }) => rest,
        ),
        psiLevels: records.psiLevels.map(({ id: _id, rowVersion: _v, updatedAt: _u, ...rest }) => rest),
      };
    },
    async findRowByKey(table, key) {
      const row = rows(table).find((r) => naturalKeyOf(table, r) === key);
      if (!row) return null;
      const { id, rowVersion, archivedAt, updatedAt: _u, updatedBy: _b, ...value } = structuredClone(row);
      return { id, rowVersion, archived: archivedAt !== null, value: value as never };
    },
    async insertRow(table, id, value, updatedBy) {
      if (rows(table).some((r) => naturalKeyOf(table, r) === naturalKeyOf(table, value))) {
        throw conflict('同じキーの行が既にあります。画面を開きなおしてください', undefined, 'duplicate_key');
      }
      const row = {
        ...structuredClone(value),
        id,
        rowVersion: 1,
        updatedAt: nextTime(),
        archivedAt: null,
        updatedBy,
      };
      rows(table).push(row as never);
      return meta(row);
    },
    async updateRow(table, id, value, updatedBy, expectedVersion) {
      const row = rows(table).find((r) => r.id === id);
      if (!row) throw notFound('行が見つかりません。画面を開きなおしてください', 'row_not_found');
      if (expectedVersion !== undefined && row.rowVersion !== expectedVersion) {
        throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
      }
      Object.assign(row, structuredClone(value), {
        archivedAt: null,
        updatedBy,
        rowVersion: row.rowVersion + 1,
        updatedAt: nextTime(),
      });
      return meta(row);
    },
    async archiveRow(table, id, updatedBy, expectedVersion) {
      const row = rows(table).find((r) => r.id === id);
      if (!row) throw notFound('行が見つかりません。画面を開きなおしてください', 'row_not_found');
      if (expectedVersion !== undefined && row.rowVersion !== expectedVersion) {
        throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
      }
      Object.assign(row, { archivedAt: nextTime(), updatedBy, rowVersion: row.rowVersion + 1 });
    },
    async upsertLevel(table, id, value, updatedBy, expectedVersion) {
      const list = levels(table);
      const row = list.find((r) => r.level === value.level);
      if (row) {
        if (expectedVersion !== undefined && row.rowVersion !== expectedVersion) {
          throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
        }
        Object.assign(row, structuredClone(value), {
          updatedBy,
          rowVersion: row.rowVersion + 1,
          updatedAt: nextTime(),
        });
        return meta(row);
      }
      if (expectedVersion !== undefined) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
      const created = {
        ...structuredClone(value),
        id,
        rowVersion: 1,
        updatedAt: nextTime(),
        archivedAt: null,
        updatedBy,
      };
      list.push(created as never);
      return meta(created);
    },
  };

  const customerReportProfiles: CustomerReportProfileRepository = {
    async find(customerId) {
      return structuredClone(d().customerReportProfiles.find((p) => p.customerId === customerId) ?? null);
    },
    async save(customerId, educationLevel, updatedBy, expectedVersion) {
      const list = d().customerReportProfiles;
      const row = list.find((p) => p.customerId === customerId);
      if (
        (row === undefined) !== (expectedVersion === undefined) ||
        (row && row.rowVersion !== expectedVersion)
      ) {
        throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
      }
      if (row) {
        Object.assign(row, {
          educationLevel,
          updatedBy,
          rowVersion: row.rowVersion + 1,
          updatedAt: nextTime(),
        });
        return structuredClone(row);
      }
      const created = { customerId, educationLevel, updatedBy, rowVersion: 1, updatedAt: nextTime() };
      list.push(created);
      return structuredClone(created);
    },
  };

  const reportAiGenerations: ReportAiGenerationRepository = {
    async insert(input) {
      if ((input.output === null) === (input.errorCode === null)) {
        throw new Error('report_ai_generations_outcome_check');
      }
      d().reportAiGenerations.push({
        ...structuredClone(input),
        careRecordId: null,
        createdAt: input.startedAt,
      });
    },
    async findById(id) {
      const g = d().reportAiGenerations.find((x) => x.id === id);
      return g
        ? {
            id: g.id,
            staffId: g.staffId,
            customerId: g.customerId,
            careRecipientId: g.careRecipientId,
            careRecordId: g.careRecordId,
            promptKey: g.promptKey,
            promptRevision: g.promptRevision,
            model: g.model,
            riskRating: g.riskRating,
            errorCode: g.errorCode,
            createdAt: g.createdAt,
          }
        : null;
    },
    async linkToCareRecord(id, careRecordId) {
      const g = d().reportAiGenerations.find((x) => x.id === id);
      if (g) g.careRecordId = careRecordId;
    },
    async keywordUsage(from, to) {
      const counts = new Map<string, { candidateCount: number; usedCount: number }>();
      for (const g of d().reportAiGenerations) {
        if (g.createdAt < from || g.createdAt >= to) continue;
        for (const id of g.candidateKeywordIds) {
          const c = counts.get(id) ?? { candidateCount: 0, usedCount: 0 };
          c.candidateCount++;
          counts.set(id, c);
        }
        for (const id of g.usedKeywordIds) {
          const c = counts.get(id) ?? { candidateCount: 0, usedCount: 0 };
          c.usedCount++;
          counts.set(id, c);
        }
      }
      return [...counts].map(([keywordId, c]) => ({ keywordId, ...c }));
    },
  };

  return { reportAi, customerReportProfiles, reportAiGenerations };
}
