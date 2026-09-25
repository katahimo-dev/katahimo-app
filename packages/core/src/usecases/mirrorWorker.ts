import type { AttendanceRowData } from '../domain/attendance';
import { DEFAULT_RETRY_POLICY, decideOnFailure, type RetryPolicy } from '../domain/outbox';
import { ENCRYPTION_PURPOSES } from '../domain/pii';
import { formatJstDateTime } from '../domain/reports/jstTime';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { AppLogPort } from '../ports/appLog';
import type { AttendanceDayRepositoryPort } from '../ports/attendanceDays';
import type { CryptoPort, EncryptionPurpose } from '../ports/crypto';
import type { MailerPort } from '../ports/mailer';
import type { MirrorKind, OutboxJobRecord, OutboxRepositoryPort } from '../ports/mirror';
import type { MirrorSenderPort } from '../ports/mirrorSender';
import type { PasswordResetCodeRepositoryPort } from '../ports/passwordResetCodes';
import type {
  AccidentReportRepositoryPort,
  CustomerRepositoryPort,
  DailyReportRepositoryPort,
  ReceiptRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { StoragePort } from '../ports/storage';
import { sendPasswordResetMail } from './auth/passwordReset';

export interface MirrorWorkerDeps {
  outbox: OutboxRepositoryPort;
  dailyReports: DailyReportRepositoryPort;
  accidentReports: AccidentReportRepositoryPort;
  receipts: ReceiptRepositoryPort;
  attendanceDays: AttendanceDayRepositoryPort;
  staff: StaffRepositoryPort;
  customers: CustomerRepositoryPort;
  crypto: CryptoPort;
  storage: StoragePort;
  sender: MirrorSenderPort;
  /** kind='password_reset_mail' のジョブ(パスワード再設定メール)の送信に使う。 */
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  mailer: MailerPort;
  appLog: AppLogPort;
  /** 省略時は DEFAULT_RETRY_POLICY。 */
  retryPolicy?: RetryPolicy;
  now?: () => Date;
}

type JobHandler = (deps: MirrorWorkerDeps, tenantId: string, targetId: string) => Promise<void>;

async function staffNameOf(deps: MirrorWorkerDeps, tenantId: string, staffId: string): Promise<string> {
  return (await deps.staff.findById(tenantId, staffId))?.name ?? '';
}

async function customerNameOf(
  deps: MirrorWorkerDeps,
  tenantId: string,
  customerId: string | null,
): Promise<string> {
  if (!customerId) return '';
  return (await deps.customers.findById(tenantId, customerId))?.name ?? '';
}

const mirrorDailyReport: JobHandler = async (deps, tenantId, targetId) => {
  const record = await deps.dailyReports.findById(tenantId, targetId);
  if (!record) return;
  const [staffName, customerName, json] = await Promise.all([
    staffNameOf(deps, tenantId, record.staffId),
    customerNameOf(deps, tenantId, record.customerId),
    deps.crypto.decrypt(tenantId, record.content, ENCRYPTION_PURPOSES.dailyReportContent),
  ]);
  const content = JSON.parse(json) as DailyReportContent;
  await deps.sender.sendDailyReport({
    reportId: record.id,
    timestampJst: formatJstDateTime(record.occurredAt),
    startTime: content.startTime,
    endTime: content.endTime,
    staffName,
    customerId: record.customerId,
    customerName,
    inputText: content.inputText,
    internalText: content.internalText,
    customerText: content.customerText,
    riskRating: record.riskRating,
    esRating: record.esRating,
  });
};

const mirrorAccidentReport: JobHandler = async (deps, tenantId, targetId) => {
  const record = await deps.accidentReports.findById(tenantId, targetId);
  if (!record) return;
  const [staffName, customerName, json] = await Promise.all([
    staffNameOf(deps, tenantId, record.staffId),
    customerNameOf(deps, tenantId, record.customerId),
    deps.crypto.decrypt(tenantId, record.content, ENCRYPTION_PURPOSES.accidentReportContent),
  ]);
  const content = JSON.parse(json) as AccidentReportContent;
  await deps.sender.sendAccidentReport({
    reportId: record.id,
    timestampJst: formatJstDateTime(record.occurredAt),
    staffName,
    customerId: record.customerId,
    customerName,
    targetName: content.targetName,
    targetDob: content.targetDob,
    occurrenceTime: content.occurrenceTime,
    location: content.location,
    accidentContent: content.accidentContent,
    situation: content.situation,
    immediateResponse: content.immediateResponse,
    parentCorrespondence: content.parentCorrespondence,
    diagnosisTreatment: content.diagnosisTreatment,
    prevention: content.prevention,
    inputText: content.inputText,
    reportType: record.reportType,
  });
};

const mirrorReceipt: JobHandler = async (deps, tenantId, targetId) => {
  const record = await deps.receipts.findById(tenantId, targetId);
  if (!record) return;
  const decryptOrBlank = (value: typeof record.amount, purpose: EncryptionPurpose) =>
    value ? deps.crypto.decrypt(tenantId, value, purpose) : Promise.resolve('');
  const [staffName, customerName, amount, storeName, handoffText, imageBytes] = await Promise.all([
    staffNameOf(deps, tenantId, record.staffId),
    customerNameOf(deps, tenantId, record.customerId),
    decryptOrBlank(record.amount, ENCRYPTION_PURPOSES.receiptAmount),
    decryptOrBlank(record.storeName, ENCRYPTION_PURPOSES.receiptStoreName),
    decryptOrBlank(record.handoffText, ENCRYPTION_PURPOSES.receiptHandoffText),
    deps.storage.get(record.fileKey),
  ]);
  if (!imageBytes) return;
  await deps.sender.sendReceipt({
    receiptId: record.id,
    uploadBatchId: record.uploadBatchId ?? '',
    staffName,
    customerId: record.customerId ?? '',
    customerName: customerName || (record.customerNameText ?? ''),
    receiptTimestampJst: formatJstDateTime(record.receiptTimestamp),
    amount,
    storeName,
    handoffText,
    imageDataUrl: `data:${record.contentType};base64,${Buffer.from(imageBytes).toString('base64')}`,
  });
};

const mirrorAttendanceDay: JobHandler = async (deps, tenantId, targetId) => {
  const record = await deps.attendanceDays.findById(tenantId, targetId);
  if (!record) return;
  const [staffName, json] = await Promise.all([
    staffNameOf(deps, tenantId, record.staffId),
    deps.crypto.decrypt(tenantId, record.rowData, ENCRYPTION_PURPOSES.attendanceRowData),
  ]);
  const rowData = JSON.parse(json) as AttendanceRowData;
  const values = Object.fromEntries(
    Object.entries(rowData).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  await deps.sender.sendAttendanceDay({
    staffName,
    businessDate: record.businessDate,
    values,
    highlightColumns: record.changedFields,
  });
};

/** 「勤怠集計」の行はGAS側がカレンダーから計算し直すため、対象スタッフと日付だけを送る。 */
const mirrorAttendanceAggregate: JobHandler = async (deps, tenantId, targetId) => {
  const record = await deps.attendanceDays.findById(tenantId, targetId);
  if (!record) return;
  await deps.sender.sendAttendanceAggregate({
    staffName: await staffNameOf(deps, tenantId, record.staffId),
    businessDate: record.businessDate,
  });
};

const HANDLERS: Partial<Record<MirrorKind, JobHandler>> = {
  daily_report: mirrorDailyReport,
  accident_report: mirrorAccidentReport,
  receipt: mirrorReceipt,
  attendance_day: mirrorAttendanceDay,
  attendance_aggregate: mirrorAttendanceAggregate,
  password_reset_mail: (deps, tenantId, targetId) => sendPasswordResetMail(deps, tenantId, targetId),
};

/**
 * outbox_jobs1件分を実際にGAS版スプレッドシート/Driveへミラーする。DBの最新値を読み直し・復号し、
 * GAS側の列にそのまま書き込める形(MirrorSenderPortのペイロード)に整形する。
 * targetId のレコードが既に存在しない場合(削除等)は何もしない。calendar_event は未対応。
 */
export async function processOutboxJob(
  deps: MirrorWorkerDeps,
  tenantId: string,
  job: OutboxJobRecord,
): Promise<void> {
  const handler = HANDLERS[job.kind];
  if (!handler) throw new Error(`未対応のミラー種別です: ${job.kind}`);
  await handler(deps, tenantId, job.targetId);
}

export interface RunOutboxBatchResult {
  processed: number;
  /** 失敗したが再試行を予約したもの。 */
  retried: number;
  /** リトライ上限に達して最終的に失敗にしたもの。 */
  failed: number;
}

/**
 * 指定テナントの処理可能なジョブを最大batchSize件処理する(ワーカーがテナントごとに呼ぶ)。
 * 失敗したジョブは指数バックオフで再試行を予約し、上限回数に達したら failed にして ERROR ログを残す。
 */
export async function runOutboxBatch(
  deps: MirrorWorkerDeps,
  tenantId: string,
  batchSize = 10,
): Promise<RunOutboxBatchResult> {
  const policy = deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const jobs = await deps.outbox.claimPending(tenantId, batchSize);
  const result: RunOutboxBatchResult = { processed: 0, retried: 0, failed: 0 };

  for (const job of jobs) {
    try {
      await processOutboxJob(deps, tenantId, job);
      await deps.outbox.markDone(tenantId, job.id);
      result.processed++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const decision = decideOnFailure(job.attempts, deps.now ? deps.now() : new Date(), policy);
      if (decision.kind === 'retry') {
        await deps.outbox.scheduleRetry(tenantId, job.id, error, decision.nextAttemptAt);
        result.retried++;
        continue;
      }
      await deps.outbox.markFailed(tenantId, job.id, error);
      await deps.appLog.write({
        tenantId,
        level: 'ERROR',
        action: 'mirror.job_failed',
        details: { jobId: job.id, kind: job.kind, targetId: job.targetId, attempts: job.attempts, error },
      });
      result.failed++;
    }
  }
  return result;
}
