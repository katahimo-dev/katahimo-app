import { randomUUID } from 'node:crypto';
import {
  buildAccidentHistoryInternalText,
  buildAccidentReportNotificationText,
  buildDailyReportNotificationText,
  formatJstDateTimeShort,
  parseJstDateTime,
} from '../domain';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { CryptoPort } from '../ports/crypto';
import type { MirrorPort } from '../ports/mirror';
import type { NotifierPort } from '../ports/notifier';
import type {
  AccidentReportRepositoryPort,
  CustomerRepositoryPort,
  DailyReportRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';

export interface ReportDeps {
  dailyReports: DailyReportRepositoryPort;
  accidentReports: AccidentReportRepositoryPort;
  customers: CustomerRepositoryPort;
  staff: StaffRepositoryPort;
  crypto: CryptoPort;
  notifier: NotifierPort;
  /** GAS版「日報」「事故報告」シートへのミラー書き込み要求をoutboxに積む(Phase 5)。 */
  mirror: MirrorPort;
}

async function resolveNames(
  deps: ReportDeps,
  tenantId: string,
  staffId: string,
  customerId: string,
): Promise<{ staffName: string; customerName: string }> {
  const [staffRecord, customerRecord] = await Promise.all([
    deps.staff.findById(tenantId, staffId),
    deps.customers.findById(tenantId, customerId),
  ]);
  if (!staffRecord) throw new Error('スタッフが見つかりません');
  if (!customerRecord) throw new Error('顧客が見つかりません');
  return { staffName: staffRecord.name, customerName: customerRecord.name };
}

export interface SaveDailyReportInput {
  /** 既存レポートの上書き保存(GAS版saveReportのrowIndex指定に相当)。 */
  reportId?: string;
  staffId: string;
  customerId: string;
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
 * 保育日報を保存する。GAS版Main.js saveReportに対応(スタッフ名/顧客IDの権限チェックは
 * 呼び出し側のAPIルートがCLAUDE.mdのセキュリティパターンに沿って解決済みのstaffIdを渡す前提)。
 * 保存に成功したらGoogle Chatへ通知する(GAS版のsendReportNotification相当)。
 */
export async function saveDailyReport(
  deps: ReportDeps,
  tenantId: string,
  input: SaveDailyReportInput,
): Promise<DailyReportView> {
  const occurredAt = input.reportDate ? parseJstDateTime(input.reportDate, input.startTime) : new Date();
  const content: DailyReportContent = {
    startTime: input.startTime || '',
    endTime: input.endTime || '',
    inputText: input.inputText || '',
    internalText: input.internalText || '',
    customerText: input.customerText || '',
  };
  const encryptedContent = await deps.crypto.encrypt(tenantId, JSON.stringify(content));

  const newInput = {
    tenantId,
    staffId: input.staffId,
    customerId: input.customerId,
    occurredAt,
    riskRating: input.riskRating,
    esRating: input.esRating,
    content: encryptedContent,
  };

  const record = input.reportId
    ? ((await deps.dailyReports.update(tenantId, input.reportId, newInput)) ??
      (await deps.dailyReports.create(newInput)))
    : await deps.dailyReports.create(newInput);

  await deps.mirror.enqueue({
    tenantId,
    kind: 'daily_report',
    targetId: record.id,
    idempotencyKey: randomUUID(),
  });

  const { staffName, customerName } = await resolveNames(deps, tenantId, input.staffId, input.customerId);
  const notificationText = buildDailyReportNotificationText({
    staffName,
    customerName,
    content: { startTime: content.startTime, endTime: content.endTime, internalText: content.internalText },
    riskRating: input.riskRating,
    esRating: input.esRating,
  });
  await deps.notifier.notify(tenantId, 'report', notificationText);

  return {
    id: record.id,
    occurredAt: record.occurredAt,
    staffId: record.staffId,
    customerId: record.customerId,
    riskRating: record.riskRating,
    esRating: record.esRating,
    content,
  };
}

export interface SaveAccidentReportInput {
  reportId?: string;
  staffId: string;
  customerId: string;
  /** '事故報告' | 'ヒヤリハット'。省略時は'事故報告'(GAS版と同じデフォルト)。 */
  reportType?: string;
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
 * 保存日時は常に保存操作時の時刻(GAS版と同じく、訪問日時の遡り指定はできない)。
 */
export async function saveAccidentReport(
  deps: ReportDeps,
  tenantId: string,
  input: SaveAccidentReportInput,
): Promise<AccidentReportView> {
  const content: AccidentReportContent = {
    targetName: input.targetName || '',
    targetDob: input.targetDob || '',
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
  const encryptedContent = await deps.crypto.encrypt(tenantId, JSON.stringify(content));

  const newInput = {
    tenantId,
    staffId: input.staffId,
    customerId: input.customerId,
    occurredAt: new Date(),
    reportType,
    content: encryptedContent,
  };

  const record = input.reportId
    ? ((await deps.accidentReports.update(tenantId, input.reportId, newInput)) ??
      (await deps.accidentReports.create(newInput)))
    : await deps.accidentReports.create(newInput);

  await deps.mirror.enqueue({
    tenantId,
    kind: 'accident_report',
    targetId: record.id,
    idempotencyKey: randomUUID(),
  });

  const { staffName, customerName } = await resolveNames(deps, tenantId, input.staffId, input.customerId);
  const notificationText = buildAccidentReportNotificationText({
    staffName,
    customerName,
    reportType,
    content,
  });
  await deps.notifier.notify(tenantId, 'report', notificationText);

  return {
    id: record.id,
    occurredAt: record.occurredAt,
    staffId: record.staffId,
    customerId: record.customerId,
    reportType: record.reportType,
    content,
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
  deps: ReportDeps,
  tenantId: string,
  input: SendVisitCompleteInput,
): Promise<void> {
  const { staffName, customerName } = await resolveNames(deps, tenantId, input.staffId, input.customerId);
  const [y, m, d] = input.visitDate.split('-');
  const dateStr = `${y}/${m}/${d}`;
  const message = `【訪問完了】\n担当: ${staffName}\n顧客名: ${customerName}\n訪問日時: ${dateStr} ${input.startTime}〜${input.endTime}`;
  await deps.notifier.notify(tenantId, 'report', message);
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
  deps: ReportDeps,
  tenantId: string,
  customerId: string,
  before: Date | null,
  limit = 5,
): Promise<HistoryItem[]> {
  const [dailyRecords, accidentRecords] = await Promise.all([
    deps.dailyReports.listByCustomer(tenantId, customerId, before, limit),
    deps.accidentReports.listByCustomer(tenantId, customerId, before, limit),
  ]);

  const staffIds = Array.from(
    new Set([...dailyRecords.map((r) => r.staffId), ...accidentRecords.map((r) => r.staffId)]),
  );
  const staffNameById = new Map<string, string>();
  await Promise.all(
    staffIds.map(async (staffId) => {
      const staffRecord = await deps.staff.findById(tenantId, staffId);
      if (!staffRecord) return;
      staffNameById.set(staffId, staffRecord.name);
    }),
  );

  const dailyItems: HistoryItem[] = await Promise.all(
    dailyRecords.map(async (r) => {
      const json = await deps.crypto.decrypt(tenantId, r.content);
      const content = JSON.parse(json) as DailyReportContent;
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
      const json = await deps.crypto.decrypt(tenantId, r.content);
      const content = JSON.parse(json) as AccidentReportContent;
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
