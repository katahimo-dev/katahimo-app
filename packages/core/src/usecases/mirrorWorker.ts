import type { AttendanceRowData } from '../domain/attendance';
import { formatJstDateTime } from '../domain/reports/jstTime';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { CryptoPort } from '../ports/crypto';
import type { OutboxJobRecord, OutboxRepositoryPort } from '../ports/mirror';
import type { MirrorSenderPort } from '../ports/mirrorSender';
import type {
  AccidentReportRepositoryPort,
  AttendanceDayRepositoryPort,
  CustomerRepositoryPort,
  DailyReportRepositoryPort,
  ReceiptRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { StoragePort } from '../ports/storage';

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
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * outbox_jobs1件分を実際にGAS版スプレッドシート/Driveへミラーする。DBの最新値を読み直し・復号し、
 * GAS側の列にそのまま書き込める形(MirrorSenderPortのペイロード)に整形する。
 *
 * 対応する種別は daily_report / accident_report / receipt / attendance_day の4つ(Phase 5の
 * うち先行実装分)。attendance_aggregate / calendar_event は未対応(将来のPhaseで追加する)。
 * targetIdのレコードが既に存在しない場合(削除等)は何もしない(エラーにはしない)。
 */
export async function processOutboxJob(
  deps: MirrorWorkerDeps,
  tenantId: string,
  job: OutboxJobRecord,
): Promise<void> {
  switch (job.kind) {
    case 'daily_report': {
      const record = await deps.dailyReports.findById(tenantId, job.targetId);
      if (!record) return;
      const [staffRecord, customerRecord, json] = await Promise.all([
        deps.staff.findById(tenantId, record.staffId),
        deps.customers.findById(tenantId, record.customerId),
        deps.crypto.decrypt(tenantId, record.content),
      ]);
      const content = JSON.parse(json) as DailyReportContent;
      await deps.sender.sendDailyReport({
        reportId: record.id,
        timestampJst: formatJstDateTime(record.occurredAt),
        startTime: content.startTime,
        endTime: content.endTime,
        staffName: staffRecord?.name ?? '',
        customerId: record.customerId,
        customerName: customerRecord?.name ?? '',
        inputText: content.inputText,
        internalText: content.internalText,
        customerText: content.customerText,
        riskRating: record.riskRating,
        esRating: record.esRating,
      });
      return;
    }

    case 'accident_report': {
      const record = await deps.accidentReports.findById(tenantId, job.targetId);
      if (!record) return;
      const [staffRecord, customerRecord, json] = await Promise.all([
        deps.staff.findById(tenantId, record.staffId),
        deps.customers.findById(tenantId, record.customerId),
        deps.crypto.decrypt(tenantId, record.content),
      ]);
      const content = JSON.parse(json) as AccidentReportContent;
      await deps.sender.sendAccidentReport({
        reportId: record.id,
        timestampJst: formatJstDateTime(record.occurredAt),
        staffName: staffRecord?.name ?? '',
        customerId: record.customerId,
        customerName: customerRecord?.name ?? '',
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
      return;
    }

    case 'receipt': {
      const record = await deps.receipts.findById(tenantId, job.targetId);
      if (!record) return;
      const [staffRecord, customerRecord, amount, storeName, handoffText, imageBytes] = await Promise.all([
        deps.staff.findById(tenantId, record.staffId),
        record.customerId ? deps.customers.findById(tenantId, record.customerId) : Promise.resolve(null),
        record.amount ? deps.crypto.decrypt(tenantId, record.amount) : Promise.resolve(''),
        record.storeName ? deps.crypto.decrypt(tenantId, record.storeName) : Promise.resolve(''),
        record.handoffText ? deps.crypto.decrypt(tenantId, record.handoffText) : Promise.resolve(''),
        deps.storage.get(record.fileKey),
      ]);
      if (!imageBytes) return;
      await deps.sender.sendReceipt({
        staffName: staffRecord?.name ?? '',
        customerId: record.customerId ?? '',
        customerName: customerRecord?.name ?? '',
        receiptTimestampJst: formatJstDateTime(record.receiptTimestamp),
        amount,
        storeName,
        handoffText,
        imageDataUrl: `data:${record.contentType};base64,${bytesToBase64(imageBytes)}`,
      });
      return;
    }

    case 'attendance_day': {
      const record = await deps.attendanceDays.findById(tenantId, job.targetId);
      if (!record) return;
      const [staffRecord, json] = await Promise.all([
        deps.staff.findById(tenantId, record.staffId),
        deps.crypto.decrypt(tenantId, record.rowData),
      ]);
      const rowData = JSON.parse(json) as AttendanceRowData;
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(rowData)) {
        if (typeof value === 'string') values[key] = value;
      }
      await deps.sender.sendAttendanceDay({
        staffName: staffRecord?.name ?? '',
        businessDate: record.businessDate,
        values,
      });
      return;
    }

    default:
      // attendance_aggregate/calendar_eventは未対応(将来のPhaseで追加する)。
      throw new Error(`未対応のミラー種別です: ${job.kind}`);
  }
}

export interface RunOutboxBatchResult {
  processed: number;
  failed: number;
}

/**
 * 指定テナントのpendingジョブを最大batchSize件処理する。ワーカー(packages/worker)が
 * テナントごとに呼び出す想定(outbox_jobsはRLS対象のため、テナントを跨いで一度に処理できない)。
 */
export async function runOutboxBatch(
  deps: MirrorWorkerDeps,
  tenantId: string,
  batchSize = 10,
): Promise<RunOutboxBatchResult> {
  const jobs = await deps.outbox.claimPending(tenantId, batchSize);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await processOutboxJob(deps, tenantId, job);
      await deps.outbox.markDone(tenantId, job.id);
      processed++;
    } catch (e) {
      await deps.outbox.markFailed(tenantId, job.id, e instanceof Error ? e.message : String(e));
      failed++;
    }
  }
  return { processed, failed };
}
