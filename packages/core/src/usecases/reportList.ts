import {
  formatZonedDateTime,
  REPORT_EXCERPT_MAX_LENGTH,
  REPORT_LIST_DEFAULT_RANGE_DAYS,
  REPORT_LIST_MAX_RANGE_DAYS,
  type ReportCsvSheet,
} from '@katahimo/shared';
import {
  addDays,
  canActForOthers,
  countDaysInclusive,
  decodeHistoryCursor,
  encodeHistoryCursor,
  forbidden,
  invalid,
  notFound,
  parseCareRecordBody,
  reportExcerpt,
  reportTimeLabel,
  zonedBusinessDate,
  zonedDayRange,
} from '../domain';
import type { CareRecordType } from '../domain/model';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { AppLogPort } from '../ports/appLog';
import type { CareRecordCursor, CareRecordListFilter, CareRecordListRow } from '../ports/records';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface ReportListDeps extends Clock {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

/** 一覧・CSV の条件(期間はテナントのタイムゾーンの業務日。両端を含む)。 */
export interface ReportCriteria {
  from?: string | undefined;
  to?: string | undefined;
  /** 書いたスタッフ。他人を扱えない役割(一般スタッフ)は無視して本人に固定する。 */
  staffId?: string | undefined;
  customerId?: string | undefined;
  kind?: CareRecordType | undefined;
}

export interface ReportRange {
  from: string;
  to: string;
  timeZone: string;
}

/** 一覧・CSV の1件で共通の項目。 */
interface ReportViewBase {
  id: string;
  occurredAt: string;
  date: string;
  time: string;
  updatedAt: string;
  staffId: string;
  staffName: string | null;
  customerId: string;
  customerName: string | null;
}

export interface ReportListItemView extends ReportViewBase {
  kind: CareRecordType;
  excerpt: string;
  riskRating: number | null;
  esRating: number | null;
}

export interface ReportListPage {
  reports: ReportListItemView[];
  nextCursor: string | null;
  range: { from: string; to: string };
  timeZone: string;
}

export type ReportDetailView =
  | (ReportViewBase & {
      kind: 'daily_report';
      rowVersion: number;
      revisionCount: number;
      riskRating: number | null;
      esRating: number | null;
      content: DailyReportContent;
    })
  | (ReportViewBase & {
      kind: 'accident' | 'near_miss';
      rowVersion: number;
      revisionCount: number;
      content: AccidentReportContent;
    });

/** CSV の1行の元(GAS版のシートと同じ列を作るための値。顧客IDはミラーと同じく取込元のID)。 */
export type ReportExportRow = ReportViewBase & {
  /** 'yyyy/MM/dd HH:mm:ss'(GAS版のシートの Timestamp 列と同じ書式。テナントのタイムゾーン)。 */
  timestamp: string;
  updatedTimestamp: string;
  /** 取込元(RESERVA)の顧客ID。無ければ本アプリの顧客ID(ミラーと同じ)。 */
  customerExternalId: string;
  riskRating: number | null;
  esRating: number | null;
} & (
    | { kind: 'daily_report'; content: DailyReportContent }
    | { kind: 'accident' | 'near_miss'; content: AccidentReportContent }
  );

const SHEET_RECORD_TYPES: Record<ReportCsvSheet, readonly CareRecordType[]> = {
  daily: ['daily_report'],
  accident: ['accident', 'near_miss'],
};

interface ResolvedCriteria {
  range: ReportRange;
  filter: CareRecordListFilter;
}

/**
 * 期間の既定(今日までの31日間)を埋め、366日を超える期間・逆転した期間を断る。書いたスタッフは
 * admin-vs-self の規則で決める(一般スタッフは常に本人)。
 */
async function resolveCriteria(
  deps: Clock,
  r: TenantRepositories,
  actor: Actor,
  criteria: ReportCriteria,
  recordTypes: readonly CareRecordType[] | undefined,
): Promise<ResolvedCriteria> {
  const timeZone = (await r.tenant()).timezone;
  const to = criteria.to ?? zonedBusinessDate(currentTime(deps), timeZone);
  const from = criteria.from ?? addDays(to, -(REPORT_LIST_DEFAULT_RANGE_DAYS - 1));
  if (from > to) {
    const message = '期間の開始日は終了日より前にしてください';
    throw invalid(message, { from: message }, 'invalid_range');
  }
  if (countDaysInclusive(from, to) > REPORT_LIST_MAX_RANGE_DAYS) {
    const message = `期間は${REPORT_LIST_MAX_RANGE_DAYS}日以内で指定してください`;
    throw invalid(message, { from: message }, 'range_too_long');
  }
  const kinds = criteria.kind
    ? (recordTypes ?? [criteria.kind]).filter((t) => t === criteria.kind)
    : recordTypes;
  return {
    range: { from, to, timeZone },
    filter: {
      from: zonedDayRange(from, timeZone).from,
      to: zonedDayRange(to, timeZone).to,
      authorStaffId: canActForOthers(actor.role) ? criteria.staffId : actor.staffId,
      customerId: criteria.customerId,
      recordTypes: kinds,
    },
  };
}

function decodeCursor(cursor: string): CareRecordCursor {
  const decoded = decodeHistoryCursor(cursor);
  if (!decoded) {
    throw invalid(
      '続きの位置の指定が正しくありません。最初から読み込み直してください',
      undefined,
      'invalid_cursor',
    );
  }
  return decoded;
}

async function staffNames(r: TenantRepositories): Promise<Map<string, string>> {
  return new Map((await r.staff.listAll()).map((s) => [s.id, s.displayName]));
}

interface CustomerRef {
  name: string | null;
  externalId: string;
}

/** まだ読んでいないお客様の氏名(と取込元のID)を cache に足す(同じお客様は1回だけ読む)。 */
async function loadCustomers(
  r: TenantRepositories,
  ids: Iterable<string>,
  cache: Map<string, CustomerRef>,
  withExternalId: boolean,
): Promise<void> {
  for (const id of new Set(ids)) {
    if (cache.has(id)) continue;
    const [customer, source] = await Promise.all([
      r.customers.findById(id),
      withExternalId ? r.customerSourceRecords.findByCustomerId(id) : Promise.resolve(null),
    ]);
    cache.set(id, { name: customer?.displayName ?? null, externalId: source?.externalId ?? id });
  }
}

function hhmm(at: Date, timeZone: string): string {
  return formatZonedDateTime(at, timeZone).slice(11, 16);
}

function baseView(
  row: CareRecordListRow,
  body: ReturnType<typeof parseCareRecordBody>,
  timeZone: string,
  names: Map<string, string>,
  customers: Map<string, CustomerRef>,
): ReportViewBase {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    date: zonedBusinessDate(row.occurredAt, timeZone),
    time: reportTimeLabel(body, hhmm(row.occurredAt, timeZone)),
    updatedAt: row.updatedAt.toISOString(),
    staffId: row.authorStaffId,
    staffName: names.get(row.authorStaffId) ?? null,
    customerId: row.customerId,
    customerName: customers.get(row.customerId)?.name ?? null,
  };
}

function toListItem(
  row: CareRecordListRow,
  timeZone: string,
  names: Map<string, string>,
  customers: Map<string, CustomerRef>,
): ReportListItemView {
  const body = parseCareRecordBody(row.recordType, row.body, row.bodySchemaVer);
  return {
    ...baseView(row, body, timeZone, names, customers),
    kind: row.recordType,
    excerpt: reportExcerpt(body, REPORT_EXCERPT_MAX_LENGTH),
    riskRating: row.riskRating,
    esRating: row.esRating,
  };
}

function slashDateTime(at: Date, timeZone: string): string {
  return formatZonedDateTime(at, timeZone).replaceAll('-', '/');
}

function toExportRow(
  row: CareRecordListRow,
  timeZone: string,
  names: Map<string, string>,
  customers: Map<string, CustomerRef>,
): ReportExportRow {
  const body = parseCareRecordBody(row.recordType, row.body, row.bodySchemaVer);
  const common = {
    ...baseView(row, body, timeZone, names, customers),
    timestamp: slashDateTime(row.occurredAt, timeZone),
    updatedTimestamp: slashDateTime(row.updatedAt, timeZone),
    customerExternalId: customers.get(row.customerId)?.externalId ?? row.customerId,
    riskRating: row.riskRating,
    esRating: row.esRating,
  };
  return body.recordType === 'daily_report'
    ? { ...common, kind: 'daily_report', content: body.content }
    : { ...common, kind: body.recordType, content: body.content };
}

/** 他のスタッフの記録を見たときだけ記録する(CLAUDE.md の Logging: 管理者が他人のデータを読んだとき)。 */
function readsOthers(actor: Actor, authorStaffId: string | undefined): boolean {
  return authorStaffId !== actor.staffId;
}

function criteriaDetails(range: ReportRange, filter: CareRecordListFilter, extra: Record<string, unknown>) {
  return {
    from: range.from,
    to: range.to,
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
    ...(filter.recordTypes ? { kinds: [...filter.recordTypes] } : {}),
    ...extra,
  };
}

/**
 * 日報・事故報告・ヒヤリハットの一覧(新しい順、keyset ページング。GAS版で管理者が「日報」「事故報告」
 * シートを見ていたことの置き換え)。コーディネーター・管理者は全員分(staffId で絞れる)、一般スタッフは
 * 本人の記録だけ。他のスタッフの記録を含む最初のページを開いたことを操作ログに残す。
 */
export async function listReports(
  deps: ReportListDeps,
  actor: Actor,
  query: ReportCriteria & { cursor?: string | undefined; limit: number },
): Promise<ReportListPage> {
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const page = await deps.uow.run(actor.tenantId, async (r) => {
    const { range, filter } = await resolveCriteria(deps, r, actor, query, undefined);
    const rows = await r.careRecords.listByPeriod(filter, after, query.limit + 1);
    const shown = rows.slice(0, query.limit);
    const names = await staffNames(r);
    const customers = new Map<string, CustomerRef>();
    await loadCustomers(
      r,
      shown.map((row) => row.customerId),
      customers,
      false,
    );
    const last = shown.at(-1);
    return {
      range,
      filter,
      reports: shown.map((row) => toListItem(row, range.timeZone, names, customers)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeHistoryCursor({ occurredAt: last.occurredAt, id: last.id })
          : null,
    };
  });
  if (!after && readsOthers(actor, page.filter.authorStaffId)) {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'INFO',
      action: 'report.list.viewed',
      actorStaffId: actor.staffId,
      targetStaffId: page.filter.authorStaffId ?? null,
      details: criteriaDetails(page.range, page.filter, { count: page.reports.length }),
      ...actor.meta,
    });
  }
  return {
    reports: page.reports,
    nextCursor: page.nextCursor,
    range: { from: page.range.from, to: page.range.to },
    timeZone: page.range.timeZone,
  };
}

/**
 * 記録1件の中身(読むだけ)。一般スタッフは本人の記録だけ(他人の記録は 403 + SECURITY ログ)。
 * コーディネーター・管理者が他のスタッフの記録を読んだら記録する。
 */
export async function getReportDetail(
  deps: ReportListDeps,
  actor: Actor,
  reportId: string,
): Promise<{ report: ReportDetailView; timeZone: string }> {
  const loaded = await deps.uow.run(actor.tenantId, async (r) => {
    const row = await r.careRecords.findListRowById(reportId);
    if (!row) return null;
    if (!canActForOthers(actor.role) && row.authorStaffId !== actor.staffId) {
      return { denied: true as const, row };
    }
    const [tenant, staff, revisionCount] = await Promise.all([
      r.tenant(),
      r.staff.findById(row.authorStaffId),
      r.careRecords.countRevisions(row.id),
    ]);
    const customers = new Map<string, CustomerRef>();
    await loadCustomers(r, [row.customerId], customers, false);
    const names = new Map(staff ? [[staff.id, staff.displayName]] : []);
    return { denied: false as const, row, timeZone: tenant.timezone, names, customers, revisionCount };
  });
  if (!loaded) throw notFound('報告が見つかりません', 'report_not_found');
  if (loaded.denied) {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'report.detail.view_denied',
      actorStaffId: actor.staffId,
      targetStaffId: loaded.row.authorStaffId,
      details: { reportId, reason: 'not_own_report' },
      ...actor.meta,
    });
    throw forbidden('他のスタッフの報告は見られません', 'forbidden');
  }
  const { row, timeZone, names, customers, revisionCount } = loaded;
  const body = parseCareRecordBody(row.recordType, row.body, row.bodySchemaVer);
  const base = {
    ...baseView(row, body, timeZone, names, customers),
    rowVersion: row.rowVersion,
    revisionCount,
  };
  const report: ReportDetailView =
    body.recordType === 'daily_report'
      ? {
          ...base,
          kind: 'daily_report',
          riskRating: row.riskRating,
          esRating: row.esRating,
          content: body.content,
        }
      : { ...base, kind: body.recordType, content: body.content };
  if (readsOthers(actor, row.authorStaffId)) {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'INFO',
      action: 'report.detail.viewed',
      actorStaffId: actor.staffId,
      targetStaffId: row.authorStaffId,
      details: { reportId: row.id, customerId: row.customerId, kind: row.recordType },
      ...actor.meta,
    });
  }
  return { report, timeZone };
}

/** CSV で1回のトランザクションに読む件数。 */
const EXPORT_BATCH_SIZE = 500;

export interface ReportExport {
  sheet: ReportCsvSheet;
  range: ReportRange;
  /** 条件に合う全件(新しい順)。500件ずつ別のトランザクションで読む(長いトランザクションを開けない)。 */
  rows(): AsyncGenerator<ReportExportRow[]>;
}

/**
 * 日報・事故報告の CSV の書き出し(コーディネーター・管理者だけ。スプレッドシートのミラーの置き換え)。
 * 権限・条件の検証と書き出しの記録(SECURITY)は読み始める前に行う(途中で切れても記録は残る)。
 */
export async function exportReports(
  deps: ReportListDeps,
  actor: Actor,
  sheet: ReportCsvSheet,
  criteria: ReportCriteria,
): Promise<ReportExport> {
  if (!canActForOthers(actor.role)) throw forbidden('権限がありません。', 'forbidden');
  const { range, filter } = await deps.uow.run(actor.tenantId, (r) =>
    resolveCriteria(deps, r, actor, criteria, SHEET_RECORD_TYPES[sheet]),
  );
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'SECURITY',
    action: 'report.list.exported',
    actorStaffId: actor.staffId,
    targetStaffId: filter.authorStaffId ?? null,
    details: criteriaDetails(range, filter, { sheet }),
    ...actor.meta,
  });
  return {
    sheet,
    range,
    async *rows() {
      // 氏名は最初に1回だけ読む。お客様は書き出しの間ずっと使い回す(同じお客様は1回だけ読む)
      const names = await deps.uow.run(actor.tenantId, staffNames);
      const customers = new Map<string, CustomerRef>();
      let after: CareRecordCursor | null = null;
      while (true) {
        const batch: { rows: ReportExportRow[]; last: CareRecordCursor | null } = await deps.uow.run(
          actor.tenantId,
          async (r) => {
            const records = await r.careRecords.listByPeriod(filter, after, EXPORT_BATCH_SIZE);
            await loadCustomers(
              r,
              records.map((row) => row.customerId),
              customers,
              true,
            );
            const last = records.at(-1);
            return {
              rows: records.map((row) => toExportRow(row, range.timeZone, names, customers)),
              last: last ? { occurredAt: last.occurredAt, id: last.id } : null,
            };
          },
        );
        if (batch.rows.length > 0) yield batch.rows;
        if (batch.rows.length < EXPORT_BATCH_SIZE || !batch.last) return;
        after = batch.last;
      }
    },
  };
}
