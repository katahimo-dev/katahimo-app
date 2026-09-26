import { AUDIT_LOG_DEFAULT_RANGE_DAYS, AUDIT_LOG_MAX_RANGE_DAYS } from '@katahimo/shared';
import { addDays, countDaysInclusive, invalid, zonedBusinessDate, zonedInstant } from '../domain';
import type { ActorType, AppLogLevel } from '../domain/model';
import type { AppLogFilter, AppLogPort, AppLogPosition, AppLogRecord } from '../ports/appLog';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface AuditLogDeps extends Clock {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

/** 閲覧・CSV の条件(期間はテナントのタイムゾーンの業務日。両端を含む)。 */
export interface AuditLogCriteria {
  from?: string | undefined;
  to?: string | undefined;
  level?: AppLogLevel | undefined;
  staffId?: string | undefined;
  /** 操作コードの前方一致。 */
  action?: string | undefined;
}

export interface AuditLogEntryView {
  id: string;
  createdAt: string;
  level: AppLogLevel;
  action: string;
  actorType: ActorType;
  actorStaffId: string | null;
  actorName: string | null;
  targetStaffId: string | null;
  targetName: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditLogRange {
  from: string;
  to: string;
  timeZone: string;
}

export interface AuditLogPage {
  entries: AuditLogEntryView[];
  nextCursor: string | null;
  range: { from: string; to: string };
  timeZone: string;
}

interface ResolvedCriteria {
  range: AuditLogRange;
  filter: AppLogFilter;
}

/** 期間の既定(今日までの7日間)を埋め、93日を超える期間・逆転した期間を断る。 */
async function resolveCriteria(
  deps: Clock,
  r: TenantRepositories,
  criteria: AuditLogCriteria,
): Promise<ResolvedCriteria> {
  const timeZone = (await r.tenant()).timezone;
  const to = criteria.to ?? zonedBusinessDate(currentTime(deps), timeZone);
  const from = criteria.from ?? addDays(to, -(AUDIT_LOG_DEFAULT_RANGE_DAYS - 1));
  if (from > to) {
    const message = '期間の開始日は終了日より前にしてください';
    throw invalid(message, { from: message }, 'invalid_range');
  }
  if (countDaysInclusive(from, to) > AUDIT_LOG_MAX_RANGE_DAYS) {
    const message = `期間は${AUDIT_LOG_MAX_RANGE_DAYS}日以内で指定してください`;
    throw invalid(message, { from: message }, 'range_too_long');
  }
  return {
    range: { from, to, timeZone },
    filter: {
      from: zonedInstant(from, 0, timeZone),
      to: zonedInstant(to, 24 * 60, timeZone),
      level: criteria.level,
      staffId: criteria.staffId,
      actionPrefix: criteria.action,
    },
  };
}

/** 一覧の続きの位置(不透明な文字列。中身は並びのキー)。 */
export function encodeAuditLogCursor(position: AppLogPosition): string {
  return Buffer.from(JSON.stringify([position.at, position.id]), 'utf8').toString('base64url');
}

export function decodeAuditLogCursor(cursor: string): AppLogPosition {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(decoded) &&
      decoded.length === 2 &&
      typeof decoded[0] === 'string' &&
      !Number.isNaN(Date.parse(decoded[0])) &&
      typeof decoded[1] === 'string' &&
      /^[0-9a-f-]{36}$/i.test(decoded[1])
    ) {
      return { at: decoded[0], id: decoded[1] };
    }
  } catch {
    // 下の検証エラーにする
  }
  throw invalid(
    '続きの位置の指定が正しくありません。最初から読み込み直してください',
    undefined,
    'invalid_cursor',
  );
}

async function staffNames(r: TenantRepositories): Promise<Map<string, string>> {
  return new Map((await r.staff.listAll()).map((s) => [s.id, s.displayName]));
}

function toEntry(record: AppLogRecord, names: Map<string, string>): AuditLogEntryView {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    level: record.level,
    action: record.action,
    actorType: record.actorType,
    actorStaffId: record.actorStaffId,
    actorName: record.actorStaffId ? (names.get(record.actorStaffId) ?? null) : null,
    targetStaffId: record.targetStaffId,
    targetName: record.targetStaffId ? (names.get(record.targetStaffId) ?? null) : null,
    details: record.details,
    ip: record.ip,
    userAgent: record.userAgent,
    requestId: record.requestId,
  };
}

/** 閲覧・ダウンロードの記録(条件だけ。絞り込んだスタッフは対象スタッフとして残す)。 */
async function logAccess(
  deps: AuditLogDeps,
  actor: Actor,
  action: 'audit_log.viewed' | 'audit_log.exported',
  criteria: AuditLogCriteria,
  range: AuditLogRange,
) {
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: action === 'audit_log.exported' ? 'SECURITY' : 'INFO',
    action,
    actorStaffId: actor.staffId,
    targetStaffId: criteria.staffId ?? null,
    details: {
      from: range.from,
      to: range.to,
      ...(criteria.level ? { level: criteria.level } : {}),
      ...(criteria.action ? { action: criteria.action } : {}),
    },
    ...actor.meta,
  });
}

/**
 * 管理者の操作ログの閲覧(新しい順、keyset ページング)。テナントのログだけ(ログイン前の tenant_id の無い記録は
 * 誰のものか確かめられないため出さない)。最初のページを開いたことを操作ログに残す。
 */
export async function listAuditLogs(
  deps: AuditLogDeps,
  actor: Actor,
  query: AuditLogCriteria & { cursor?: string | undefined; limit: number },
): Promise<AuditLogPage> {
  const after = query.cursor ? decodeAuditLogCursor(query.cursor) : null;
  const page = await deps.uow.run(actor.tenantId, async (r) => {
    const { range, filter } = await resolveCriteria(deps, r, query);
    const records = await r.appLogs.list(filter, { after, limit: query.limit + 1 });
    const names = await staffNames(r);
    const shown = records.slice(0, query.limit);
    const last = shown.at(-1);
    return {
      range,
      entries: shown.map((record) => toEntry(record, names)),
      nextCursor: records.length > query.limit && last ? encodeAuditLogCursor(last.position) : null,
    };
  });
  if (!after) await logAccess(deps, actor, 'audit_log.viewed', query, page.range);
  return {
    entries: page.entries,
    nextCursor: page.nextCursor,
    range: { from: page.range.from, to: page.range.to },
    timeZone: page.range.timeZone,
  };
}

/** CSV で1回のトランザクションに読む件数。 */
const EXPORT_BATCH_SIZE = 500;

export interface AuditLogExport {
  range: AuditLogRange;
  /** 条件に合う全件(新しい順)。500件ずつ別のトランザクションで読む(長いトランザクションを開けない)。 */
  entries(): AsyncGenerator<AuditLogEntryView[]>;
}

/**
 * 操作ログの CSV ダウンロード(GAS版の Drive の CSV ログの置き換え)。条件の検証とダウンロードの記録は
 * 読み始める前に行う(途中で切れても記録は残る)。
 */
export async function exportAuditLogs(
  deps: AuditLogDeps,
  actor: Actor,
  criteria: AuditLogCriteria,
): Promise<AuditLogExport> {
  const { range, filter } = await deps.uow.run(actor.tenantId, (r) => resolveCriteria(deps, r, criteria));
  await logAccess(deps, actor, 'audit_log.exported', criteria, range);
  return {
    range,
    async *entries() {
      let after: AppLogPosition | null = null;
      while (true) {
        const batch: { entries: AuditLogEntryView[]; last: AppLogPosition | null } = await deps.uow.run(
          actor.tenantId,
          async (r) => {
            const records = await r.appLogs.list(filter, { after, limit: EXPORT_BATCH_SIZE });
            const names = await staffNames(r);
            return {
              entries: records.map((record) => toEntry(record, names)),
              last: records.at(-1)?.position ?? null,
            };
          },
        );
        if (batch.entries.length > 0) yield batch.entries;
        if (batch.entries.length < EXPORT_BATCH_SIZE || !batch.last) return;
        after = batch.last;
      }
    },
  };
}
