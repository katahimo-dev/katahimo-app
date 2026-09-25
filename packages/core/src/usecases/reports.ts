import { randomUUID } from 'node:crypto';
import {
  buildAccidentHistoryInternalText,
  buildAccidentReportNotificationText,
  buildDailyReportNotificationText,
  ENCRYPTION_PURPOSES,
  formatJstDateTimeShort,
  parseJstDateTime,
} from '../domain';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { AppLogPort } from '../ports/appLog';
import type { CryptoPort } from '../ports/crypto';
import type { MirrorPort } from '../ports/mirror';
import type { NotifierPort } from '../ports/notifier';
import type {
  AccidentReportRepositoryPort,
  CustomerRepositoryPort,
  DailyReportRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import { notifyWithLog } from './notify';
import type { Actor, RequestMeta } from './requestMeta';

export interface ReportDeps {
  dailyReports: DailyReportRepositoryPort;
  accidentReports: AccidentReportRepositoryPort;
  customers: CustomerRepositoryPort;
  staff: StaffRepositoryPort;
  crypto: CryptoPort;
  notifier: NotifierPort;
  /** GAS版「日報」「事故報告」シートへのミラー書き込み要求をoutboxに積む。 */
  mirror: MirrorPort;
  appLog: AppLogPort;
}

export type SaveReportFailure = 'report_not_found' | 'forbidden' | 'staff_not_found' | 'customer_not_found';

export type SaveReportResult<T> = { ok: true; report: T } | { ok: false; reason: SaveReportFailure };

/** 保存・上書きの共通入力。担当スタッフはクライアントの申告ではなくactorから決める。 */
interface SaveReportCommon {
  actor: Actor;
  /** 管理者が他スタッフ名義で保存する場合のみ有効。管理者以外が渡しても無視する。 */
  requestedStaffId?: string;
  /** 既存レポートの上書き保存(GAS版のrowIndex指定に相当)。 */
  reportId?: string;
  customerId: string;
  meta?: RequestMeta;
}

interface ReportTarget {
  staffId: string;
  staffName: string;
  customerName: string;
}

/**
 * 保存先の担当スタッフを決め、上書きの権限を確認する(CLAUDE.mdのadmin-vs-selfパターン)。
 * - 管理者以外: 常に本人。上書きは本人のレポートに限る(GAS版は行番号さえ分かれば他人の日報を
 *   上書きできてしまっていた穴を塞ぐ)。
 * - 管理者: 明示指定 → 上書き対象の元の担当者 → 本人 の順。
 */
async function resolveReportTarget(
  deps: ReportDeps,
  tenantId: string,
  input: SaveReportCommon,
  existingStaffId: string | null,
): Promise<{ ok: true; target: ReportTarget } | { ok: false; reason: SaveReportFailure }> {
  const { actor } = input;
  if (existingStaffId !== null && !actor.isAdmin && existingStaffId !== actor.staffId) {
    return { ok: false, reason: 'forbidden' };
  }
  const staffId = actor.isAdmin
    ? input.requestedStaffId?.trim() || existingStaffId || actor.staffId
    : actor.staffId;

  const [staff, customer] = await Promise.all([
    deps.staff.findById(tenantId, staffId),
    deps.customers.findById(tenantId, input.customerId),
  ]);
  if (!staff) return { ok: false, reason: 'staff_not_found' };
  if (!customer) return { ok: false, reason: 'customer_not_found' };
  return { ok: true, target: { staffId, staffName: staff.name, customerName: customer.name } };
}

async function logReportDenied(
  deps: ReportDeps,
  tenantId: string,
  kind: 'daily' | 'accident',
  input: SaveReportCommon,
  reason: SaveReportFailure,
  existingStaffId: string | null,
): Promise<void> {
  await deps.appLog.write({
    tenantId,
    level: reason === 'forbidden' ? 'SECURITY' : 'WARN',
    action: `report.${kind}.save_denied`,
    actorStaffId: input.actor.staffId,
    targetStaffId: existingStaffId,
    details: { reason, reportId: input.reportId ?? null, customerId: input.customerId },
    ...input.meta,
  });
}

async function logReportSaved(
  deps: ReportDeps,
  tenantId: string,
  kind: 'daily' | 'accident',
  input: SaveReportCommon,
  reportId: string,
  targetStaffId: string,
): Promise<void> {
  await deps.appLog.write({
    tenantId,
    level: 'INFO',
    action: `report.${kind}.saved`,
    actorStaffId: input.actor.staffId,
    targetStaffId: targetStaffId === input.actor.staffId ? null : targetStaffId,
    details: { reportId, customerId: input.customerId, mode: input.reportId ? 'update' : 'create' },
    ...input.meta,
  });
}

export interface SaveDailyReportInput extends SaveReportCommon {
  /** 'YYYY-MM-DD'。省略時は保存時刻をそのまま使う(GAS版saveReportと同じ)。 */
  reportDate?: string;
  startTime: string;
  endTime: string;
  inputText: string;
  internalText: string;
  customerText: string;
  riskRating: number | null;
  esRating: number | null;
}

export interface DailyReportView {
  id: string;
  occurredAt: Date;
  staffId: string;
  customerId: string;
  riskRating: number | null;
  esRating: number | null;
  content: DailyReportContent;
}

/**
 * 保育日報を保存する。GAS版Main.js saveReportに対応。
 * 保存に成功したらGoogle Chatへ通知し(GAS版sendReportNotification)、スプレッドシートへのミラーを積む。
 */
export async function saveDailyReport(
  deps: ReportDeps,
  tenantId: string,
  input: SaveDailyReportInput,
): Promise<SaveReportResult<DailyReportView>> {
  const existing = input.reportId ? await deps.dailyReports.findById(tenantId, input.reportId) : null;
  if (input.reportId && !existing) {
    await logReportDenied(deps, tenantId, 'daily', input, 'report_not_found', null);
    return { ok: false, reason: 'report_not_found' };
  }
  const resolved = await resolveReportTarget(deps, tenantId, input, existing?.staffId ?? null);
  if (!resolved.ok) {
    await logReportDenied(deps, tenantId, 'daily', input, resolved.reason, existing?.staffId ?? null);
    return resolved;
  }
  const { target } = resolved;

  const content: DailyReportContent = {
    startTime: input.startTime,
    endTime: input.endTime,
    inputText: input.inputText,
    internalText: input.internalText,
    customerText: input.customerText,
  };
  const record = {
    tenantId,
    staffId: target.staffId,
    customerId: input.customerId,
    occurredAt: input.reportDate ? parseJstDateTime(input.reportDate, input.startTime) : new Date(),
    riskRating: input.riskRating,
    esRating: input.esRating,
    content: await deps.crypto.encrypt(
      tenantId,
      JSON.stringify(content),
      ENCRYPTION_PURPOSES.dailyReportContent,
    ),
  };
  const saved = existing
    ? await deps.dailyReports.update(tenantId, existing.id, record)
    : await deps.dailyReports.create(record);
  if (!saved) return { ok: false, reason: 'report_not_found' };

  await deps.mirror.enqueue({
    tenantId,
    kind: 'daily_report',
    targetId: saved.id,
    idempotencyKey: randomUUID(),
  });
  await notifyWithLog(
    deps,
    tenantId,
    'report',
    buildDailyReportNotificationText({
      staffName: target.staffName,
      customerName: target.customerName,
      content,
      riskRating: input.riskRating,
      esRating: input.esRating,
    }),
    input.actor.staffId,
  );
  await logReportSaved(deps, tenantId, 'daily', input, saved.id, target.staffId);

  return {
    ok: true,
    report: {
      id: saved.id,
      occurredAt: saved.occurredAt,
      staffId: saved.staffId,
      customerId: saved.customerId,
      riskRating: saved.riskRating,
      esRating: saved.esRating,
      content,
    },
  };
}

export interface SaveAccidentReportInput extends SaveReportCommon {
  /** '事故報告' | 'ヒヤリハット'。 */
  reportType: string;
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  inputText: string;
}

export interface AccidentReportView {
  id: string;
  occurredAt: Date;
  staffId: string;
  customerId: string;
  reportType: string;
  content: AccidentReportContent;
}

/**
 * 事故報告/ヒヤリハットを保存する。GAS版Main.js saveAccidentReportに対応。
 * 記録日時は常に保存操作時の時刻(GAS版と同じく、上書き時も保存時刻に更新される)。
 */
export async function saveAccidentReport(
  deps: ReportDeps,
  tenantId: string,
  input: SaveAccidentReportInput,
): Promise<SaveReportResult<AccidentReportView>> {
  const existing = input.reportId ? await deps.accidentReports.findById(tenantId, input.reportId) : null;
  if (input.reportId && !existing) {
    await logReportDenied(deps, tenantId, 'accident', input, 'report_not_found', null);
    return { ok: false, reason: 'report_not_found' };
  }
  const resolved = await resolveReportTarget(deps, tenantId, input, existing?.staffId ?? null);
  if (!resolved.ok) {
    await logReportDenied(deps, tenantId, 'accident', input, resolved.reason, existing?.staffId ?? null);
    return resolved;
  }
  const { target } = resolved;

  const content: AccidentReportContent = {
    targetName: input.targetName,
    targetDob: input.targetDob,
    occurrenceTime: input.occurrenceTime,
    location: input.location,
    accidentContent: input.accidentContent,
    situation: input.situation,
    immediateResponse: input.immediateResponse,
    parentCorrespondence: input.parentCorrespondence,
    diagnosisTreatment: input.diagnosisTreatment,
    prevention: input.prevention,
    inputText: input.inputText,
  };
  const reportType = input.reportType || '事故報告';
  const record = {
    tenantId,
    staffId: target.staffId,
    customerId: input.customerId,
    occurredAt: new Date(),
    reportType,
    content: await deps.crypto.encrypt(
      tenantId,
      JSON.stringify(content),
      ENCRYPTION_PURPOSES.accidentReportContent,
    ),
  };
  const saved = existing
    ? await deps.accidentReports.update(tenantId, existing.id, record)
    : await deps.accidentReports.create(record);
  if (!saved) return { ok: false, reason: 'report_not_found' };

  await deps.mirror.enqueue({
    tenantId,
    kind: 'accident_report',
    targetId: saved.id,
    idempotencyKey: randomUUID(),
  });
  await notifyWithLog(
    deps,
    tenantId,
    'report',
    buildAccidentReportNotificationText({
      staffName: target.staffName,
      customerName: target.customerName,
      reportType,
      content,
    }),
    input.actor.staffId,
  );
  await logReportSaved(deps, tenantId, 'accident', input, saved.id, target.staffId);

  return {
    ok: true,
    report: {
      id: saved.id,
      occurredAt: saved.occurredAt,
      staffId: saved.staffId,
      customerId: saved.customerId,
      reportType: saved.reportType,
      content,
    },
  };
}

export interface SendVisitCompleteInput {
  staffId: string;
  customerId: string;
  /** 'YYYY-MM-DD' */
  visitDate: string;
  /** 'HH:mm' */
  startTime: string;
  /** 'HH:mm' */
  endTime: string;
}

/**
 * 「訪問完了」ボタン用の通知のみ(DB書き込みは無い)。GAS版sendVisitComplete/
 * sendVisitCompleteNotificationに対応。担当者名・顧客名はクライアント指定を信用せず、
 * 常にセッション/DBから解決する(CLAUDE.mdのセキュリティパターン)。
 */
export async function sendVisitCompleteNotification(
  deps: Pick<ReportDeps, 'staff' | 'customers' | 'notifier' | 'appLog'>,
  tenantId: string,
  input: SendVisitCompleteInput,
): Promise<{ ok: true } | { ok: false; reason: 'staff_not_found' | 'customer_not_found' }> {
  const [staff, customer] = await Promise.all([
    deps.staff.findById(tenantId, input.staffId),
    deps.customers.findById(tenantId, input.customerId),
  ]);
  if (!staff) return { ok: false, reason: 'staff_not_found' };
  if (!customer) return { ok: false, reason: 'customer_not_found' };

  const dateStr = input.visitDate.replaceAll('-', '/');
  const message = `【訪問完了】\n担当: ${staff.name}\n顧客名: ${customer.name}\n訪問日時: ${dateStr} ${input.startTime}〜${input.endTime}`;
  await notifyWithLog(deps, tenantId, 'report', message, input.staffId);
  return { ok: true };
}

export interface HistoryItem {
  type: 'daily' | 'accident';
  id: string;
  /** カーソルページネーションの次回startAfterに使う。ISO8601文字列。 */
  occurredAtIso: string;
  /** 表示用 'yyyy/MM/dd HH:mm'。GAS版getCustomerReportsのfmt()と同じ書式。 */
  timestamp: string;
  staff: string;
  original: string;
  internal: string;
  customer: string;
  risk?: number | null;
  es?: number | null;
  isAccident?: boolean;
  subtype?: string;
}

/**
 * 顧客の活動記録(日報+事故報告)を新しい順に取得する。GAS版Main.js getCustomerReportsに対応。
 * beforeを渡すと、それより古いものだけを返す(「もっと見る」ページネーション)。
 */
export async function getCustomerHistory(
  deps: Pick<ReportDeps, 'dailyReports' | 'accidentReports' | 'staff' | 'crypto'>,
  tenantId: string,
  customerId: string,
  before: Date | null,
  limit = 5,
): Promise<HistoryItem[]> {
  const [dailyRecords, accidentRecords] = await Promise.all([
    deps.dailyReports.listByCustomer(tenantId, customerId, before, limit),
    deps.accidentReports.listByCustomer(tenantId, customerId, before, limit),
  ]);

  const staffIds = Array.from(new Set([...dailyRecords, ...accidentRecords].map((r) => r.staffId)));
  const staffNameById = new Map<string, string>();
  await Promise.all(
    staffIds.map(async (staffId) => {
      const staffRecord = await deps.staff.findById(tenantId, staffId);
      if (staffRecord) staffNameById.set(staffId, staffRecord.name);
    }),
  );

  const dailyItems: HistoryItem[] = await Promise.all(
    dailyRecords.map(async (r) => {
      const content = JSON.parse(
        await deps.crypto.decrypt(tenantId, r.content, ENCRYPTION_PURPOSES.dailyReportContent),
      ) as DailyReportContent;
      return {
        type: 'daily' as const,
        id: r.id,
        occurredAtIso: r.occurredAt.toISOString(),
        timestamp: formatJstDateTimeShort(r.occurredAt),
        staff: staffNameById.get(r.staffId) ?? '',
        original: content.inputText,
        internal: content.internalText,
        customer: content.customerText,
        risk: r.riskRating,
        es: r.esRating,
      };
    }),
  );

  const accidentItems: HistoryItem[] = await Promise.all(
    accidentRecords.map(async (r) => {
      const content = JSON.parse(
        await deps.crypto.decrypt(tenantId, r.content, ENCRYPTION_PURPOSES.accidentReportContent),
      ) as AccidentReportContent;
      return {
        type: 'accident' as const,
        id: r.id,
        occurredAtIso: r.occurredAt.toISOString(),
        timestamp: formatJstDateTimeShort(r.occurredAt),
        staff: staffNameById.get(r.staffId) ?? '',
        original: content.inputText,
        internal: buildAccidentHistoryInternalText(content),
        customer: content.parentCorrespondence,
        isAccident: true,
        subtype: r.reportType || '事故報告',
      };
    }),
  );

  return [...dailyItems, ...accidentItems]
    .sort((a, b) => (a.occurredAtIso < b.occurredAtIso ? 1 : -1))
    .slice(0, limit);
}
