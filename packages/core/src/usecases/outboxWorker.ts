import {
  DEFAULT_RETRY_POLICY,
  decideOnFailure,
  ENCRYPTION_PURPOSES as P,
  PermanentOutboxError,
  parseCareRecordBody,
  projectDay,
  type RetryPolicy,
  reportTypeLabelOf,
} from '../domain';
import { MIRROR_TOPICS, type OutboxTopic } from '../domain/model';
import { formatJstDateTime } from '../domain/reports/jstTime';
import type { AppLogPort } from '../ports/appLog';
import type { CryptoPort } from '../ports/crypto';
import type { MailerPort } from '../ports/mailer';
import type { MirrorSenderPort } from '../ports/mirrorSender';
import type { ClaimedOutboxMessage, OutboxQueuePort } from '../ports/outbox';
import type { StoragePort } from '../ports/storage';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import { toSheetDay } from './attendance/records';
import { sendPasswordResetMail } from './auth/passwordReset';
import type { Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface OutboxWorkerDeps extends Clock {
  queue: OutboxQueuePort;
  uow: UnitOfWorkPort;
  crypto: CryptoPort;
  storage: StoragePort;
  sender: MirrorSenderPort;
  mailer: MailerPort;
  appLog: AppLogPort;
  /** MIRROR_TO_GOOGLE_SHEETS。無効ならミラーのトピックは送らずに完了にする(API と同じ設定を使う)。 */
  mirrorEnabled: boolean;
  /** このワーカーの識別子(locked_by)。 */
  workerId: string;
  /** 取り出したメッセージのリース(1件の処理の最長時間より長くする)。 */
  leaseMs: number;
  /** 再試行の間隔(省略時は DEFAULT_RETRY_POLICY)。試行回数の上限はメッセージの max_attempts。 */
  retryPolicy?: Omit<RetryPolicy, 'maxAttempts'>;
}

type Handler = (deps: OutboxWorkerDeps, message: ClaimedOutboxMessage) => Promise<void>;

async function staffNameOf(r: TenantRepositories, staffId: string): Promise<string> {
  return (await r.staff.findById(staffId))?.displayName ?? '';
}

/** GAS側のシートに書く顧客ID(RESERVA の顧客ID。取込元の無い顧客は本アプリのID)。 */
async function customerRefOf(r: TenantRepositories, customerId: string | null) {
  if (!customerId) return { id: '', name: '' };
  const [customer, source] = await Promise.all([
    r.customers.findById(customerId),
    r.customerSourceRecords.findByCustomerId(customerId),
  ]);
  return { id: source?.externalId ?? customerId, name: customer?.displayName ?? '' };
}

const mirrorCareRecord: Handler = async (deps, message) => {
  const loaded = await deps.uow.run(message.tenantId, async (r) => {
    const record = await r.careRecords.findById(message.aggregateId);
    if (!record) return null;
    return {
      record,
      staffName: await staffNameOf(r, record.authorStaffId),
      customer: await customerRefOf(r, record.customerId),
    };
  });
  if (!loaded) return;
  const { record, staffName, customer } = loaded;
  const json = await deps.crypto.decrypt(
    { tenantId: message.tenantId, purpose: P.careRecordBody, rowId: record.id },
    record.bodyEnc,
  );
  const body = parseCareRecordBody(record.recordType, json, record.bodySchemaVer);
  const common = {
    reportId: record.id,
    timestampJst: formatJstDateTime(record.occurredAt),
    staffName,
    customerId: customer.id,
    customerName: customer.name,
  };
  if (body.recordType === 'daily_report') {
    await deps.sender.sendDailyReport({
      ...common,
      startTime: body.content.startTime,
      endTime: body.content.endTime,
      inputText: body.content.inputText,
      internalText: body.content.internalText,
      customerText: body.content.customerText,
      riskRating: record.riskRating,
      esRating: record.esRating,
    });
    return;
  }
  await deps.sender.sendAccidentReport({
    ...common,
    ...body.content,
    reportType: reportTypeLabelOf(body.recordType),
  });
};

const mirrorReceipt: Handler = async (deps, message) => {
  const loaded = await deps.uow.run(message.tenantId, async (r) => {
    const receipt = await r.receipts.findById(message.aggregateId);
    if (!receipt) return null;
    const [upload, file, isFirst, staffName, customer] = await Promise.all([
      r.receipts.findUpload(receipt.uploadId),
      r.storedFiles.findById(receipt.fileId),
      r.receipts.isFirstOfUpload(receipt),
      staffNameOf(r, receipt.staffId),
      customerRefOf(r, receipt.customerId),
    ]);
    return { receipt, upload, file, isFirst, staffName, customer };
  });
  if (!loaded) return;
  const { receipt, upload, file, isFirst, staffName, customer } = loaded;
  const image = file ? await deps.storage.get(file.storageKey) : null;
  if (!file || !image) {
    // 画像が無いと GAS側に送れない(再試行しても直らない)。送らずに記録だけ残す
    await deps.appLog.write({
      tenantId: message.tenantId,
      level: 'WARN',
      action: 'mirror.receipt.image_missing',
      actorType: 'system',
      details: { receiptId: receipt.id, fileId: receipt.fileId },
    });
    return;
  }
  const ctx = (purpose: (typeof P)[keyof typeof P], rowId: string) => ({
    tenantId: message.tenantId,
    purpose,
    rowId,
  });
  const [storeName, handoffText] = await Promise.all([
    receipt.storeNameEnc
      ? deps.crypto.decrypt(ctx(P.receiptStoreName, receipt.id), receipt.storeNameEnc)
      : '',
    isFirst && upload?.handoffTextEnc
      ? deps.crypto.decrypt(ctx(P.receiptHandoffText, upload.id), upload.handoffTextEnc)
      : '',
  ]);
  await deps.sender.sendReceipt({
    receiptId: receipt.id,
    uploadBatchId: receipt.uploadId,
    staffName,
    customerId: customer.id,
    customerName: customer.name || (receipt.customerNameText ?? ''),
    receiptTimestampJst: formatJstDateTime(receipt.receiptedAt),
    amount: receipt.amountYen === null ? '' : String(receipt.amountYen),
    storeName,
    handoffText,
    imageDataUrl: `data:${file.contentType};base64,${Buffer.from(image).toString('base64')}`,
  });
};

const mirrorAttendanceDay: Handler = async (deps, message) => {
  const loaded = await deps.uow.run(message.tenantId, async (r) => {
    const rows = await r.attendance.findDayById(message.aggregateId);
    if (!rows) return null;
    const timeZone = (await r.tenant()).timezone;
    return {
      rows,
      staffName: await staffNameOf(r, rows.staffId),
      sheet: await toSheetDay(deps.crypto, r.tenantId, timeZone, rows),
    };
  });
  if (!loaded) return;
  // DB が正のため、入力列は全て送る(空になった列はシートでも空にする)
  const projection = projectDay(loaded.sheet);
  await deps.sender.sendAttendanceDay({
    staffName: loaded.staffName,
    businessDate: loaded.rows.businessDate,
    values: projection.rowData,
    highlightColumns: projection.changedFields,
  });
};

/** 「勤怠集計」の行は GAS側がカレンダーから計算し直すため、対象スタッフと日付だけを送る。 */
const mirrorAttendanceAggregate: Handler = async (deps, message) => {
  const loaded = await deps.uow.run(message.tenantId, async (r) => {
    const rows = await r.attendance.findDayById(message.aggregateId);
    return rows ? { businessDate: rows.businessDate, staffName: await staffNameOf(r, rows.staffId) } : null;
  });
  if (loaded) await deps.sender.sendAttendanceAggregate(loaded);
};

const HANDLERS: Record<OutboxTopic, Handler> = {
  'mirror.care_record': mirrorCareRecord,
  'mirror.receipt': mirrorReceipt,
  'mirror.attendance_day': mirrorAttendanceDay,
  'mirror.attendance_aggregate': mirrorAttendanceAggregate,
  'mail.password_reset': (deps, message) =>
    sendPasswordResetMail(deps, message.tenantId, message.aggregateId),
};

export type ProcessOutcome = 'idle' | 'done' | 'skipped' | 'retried' | 'failed';

/**
 * outbox から1件取り出して処理する(テナントを横断して FOR UPDATE SKIP LOCKED で1件ずつ。複数のワーカーが
 * 同時に動いても同じメッセージを二重に処理しない)。対象の行は処理のたびに DB から読み直す(ペイロードは ID だけ)。
 * 失敗は指数バックオフで再試行し、max_attempts 回で dead(ERROR ログ)、再試行しても直らない失敗は failed。
 */
export async function processNextOutboxMessage(deps: OutboxWorkerDeps): Promise<ProcessOutcome> {
  const now = currentTime(deps);
  const message = await deps.queue.claimNext(deps.workerId, deps.leaseMs, now);
  if (!message) return 'idle';
  if (!deps.mirrorEnabled && MIRROR_TOPICS.includes(message.topic)) {
    await deps.queue.complete(message.id, message.tenantId, currentTime(deps));
    return 'skipped';
  }
  try {
    await HANDLERS[message.topic](deps, message);
    await deps.queue.complete(message.id, message.tenantId, currentTime(deps));
    return 'done';
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const at = currentTime(deps);
    const policy = { ...DEFAULT_RETRY_POLICY, ...deps.retryPolicy, maxAttempts: message.maxAttempts };
    const decision =
      e instanceof PermanentOutboxError
        ? { kind: 'give_up' as const }
        : decideOnFailure(message.attempts, at, policy);
    if (decision.kind === 'retry') {
      await deps.queue.retry(message.id, message.tenantId, error, decision.nextAttemptAt);
      return 'retried';
    }
    const status = e instanceof PermanentOutboxError ? 'failed' : 'dead';
    await deps.queue.giveUp(message.id, message.tenantId, error, status, at);
    await deps.appLog.write({
      tenantId: message.tenantId,
      level: 'ERROR',
      action: 'outbox.message_failed',
      actorType: 'system',
      details: {
        messageId: message.id,
        topic: message.topic,
        aggregateId: message.aggregateId,
        attempts: message.attempts,
        status,
        error: error.slice(0, 300),
      },
    });
    return 'failed';
  }
}

export interface DrainOutboxResult {
  done: number;
  skipped: number;
  retried: number;
  failed: number;
}

/** 取れるメッセージが無くなるか、maxMessages 件処理するか、shouldStop が true になるまで1件ずつ処理する。 */
export async function drainOutbox(
  deps: OutboxWorkerDeps,
  options: { maxMessages: number; shouldStop?: () => boolean },
): Promise<DrainOutboxResult> {
  const result: DrainOutboxResult = { done: 0, skipped: 0, retried: 0, failed: 0 };
  for (let i = 0; i < options.maxMessages; i++) {
    if (options.shouldStop?.()) break;
    const outcome = await processNextOutboxMessage(deps);
    if (outcome === 'idle') break;
    result[outcome]++;
  }
  return result;
}
