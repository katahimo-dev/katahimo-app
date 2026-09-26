import {
  ATTENDANCE_COLUMN_KEYS,
  type AttendanceColumnKey,
  DEFAULT_RETRY_POLICY,
  decideOnFailure,
  PermanentOutboxError,
  parseCareRecordBody,
  projectDay,
  type RetryPolicy,
  reportTypeLabelOf,
} from '../domain';
import { MIRROR_TOPICS, type OutboxTopic } from '../domain/model';
import { formatJstDateTime } from '../domain/reports/jstTime';
import type { AppLogPort } from '../ports/appLog';
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
  const body = parseCareRecordBody(record.recordType, record.body, record.bodySchemaVer);
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
  const storeName = receipt.storeName ?? '';
  const handoffText = isFirst ? (upload?.handoffText ?? '') : '';
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

/** ペイロードの書く列(出勤簿の列として正しいものだけ)。 */
function attendanceColumnsOf(payload: Record<string, unknown>): AttendanceColumnKey[] {
  const columns = Array.isArray(payload.columns) ? payload.columns : [];
  return ATTENDANCE_COLUMN_KEYS.filter((key) => columns.includes(key));
}

const mirrorAttendanceDay: Handler = async (deps, message) => {
  const loaded = await deps.uow.run(message.tenantId, async (r) => {
    const rows = await r.attendance.findDayById(message.aggregateId);
    if (!rows) return null;
    const timeZone = (await r.tenant()).timezone;
    return {
      rows,
      staffName: await staffNameOf(r, rows.staffId),
      sheet: toSheetDay(timeZone, rows),
    };
  });
  if (!loaded) return;
  // 書き込みで表示の変わった列だけを、今の値で送る(本アプリで空にした列はシートでも空にする。シートにだけある
  // 値の列は触らない)。版の違う複数のメッセージは、それぞれの列を今の値で送る
  const projection = projectDay(loaded.sheet);
  const columns = attendanceColumnsOf(message.payload);
  await deps.sender.sendAttendanceDay({
    staffName: loaded.staffName,
    businessDate: loaded.rows.businessDate,
    values: Object.fromEntries(columns.map((c) => [c, projection.rowData[c]])),
    highlightColumns: projection.changedFields.filter((c) => columns.includes(c)),
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

export type ProcessOutcome = 'idle' | 'done' | 'skipped' | 'retried' | 'failed' | 'lease_lost';

/** リースが切れたまま試行回数の上限に達したメッセージを dead にする(取り直さない)。 */
const LEASE_EXHAUSTED_ERROR = '処理中のままリースが切れ、試行回数の上限に達しました';

async function logDead(
  deps: OutboxWorkerDeps,
  message: { id: string; tenantId: string; topic: OutboxTopic; aggregateId: string; attempts: number },
  status: 'failed' | 'dead',
  error: string,
): Promise<void> {
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
}

/**
 * outbox から1件取り出して処理する(テナントを横断して FOR UPDATE SKIP LOCKED で1件ずつ。複数のワーカーが
 * 同時に動いても同じメッセージを二重に処理しない)。対象の行は処理のたびに DB から読み直す(ペイロードは ID だけ)。
 * 失敗は指数バックオフで再試行し、max_attempts 回で dead(ERROR ログ)、再試行しても直らない失敗は failed。
 * 処理中にリースが切れて別のワーカーが取り直していたら、結果は書かない(lease_lost、WARN ログ)。
 * 処理中のままリースが切れて試行回数の上限に達したもの(処理の途中でワーカーが落ち続けた等)は取り直さず dead にする。
 */
export async function processNextOutboxMessage(deps: OutboxWorkerDeps): Promise<ProcessOutcome> {
  const now = currentTime(deps);
  for (const expired of await deps.queue.expireExhaustedLeases(now, LEASE_EXHAUSTED_ERROR)) {
    await logDead(deps, expired, 'dead', LEASE_EXHAUSTED_ERROR);
  }
  const message = await deps.queue.claimNext(deps.workerId, deps.leaseMs, now);
  if (!message) return 'idle';
  const leaseLost = async (): Promise<ProcessOutcome> => {
    await deps.appLog.write({
      tenantId: message.tenantId,
      level: 'WARN',
      action: 'outbox.lease_lost',
      actorType: 'system',
      details: { messageId: message.id, topic: message.topic, attempts: message.attempts },
    });
    return 'lease_lost';
  };
  if (!deps.mirrorEnabled && MIRROR_TOPICS.includes(message.topic)) {
    return (await deps.queue.complete(message, currentTime(deps))) ? 'skipped' : leaseLost();
  }
  try {
    await HANDLERS[message.topic](deps, message);
    return (await deps.queue.complete(message, currentTime(deps))) ? 'done' : leaseLost();
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const at = currentTime(deps);
    const policy = { ...DEFAULT_RETRY_POLICY, ...deps.retryPolicy, maxAttempts: message.maxAttempts };
    const decision =
      e instanceof PermanentOutboxError
        ? { kind: 'give_up' as const }
        : decideOnFailure(message.attempts, at, policy);
    if (decision.kind === 'retry') {
      return (await deps.queue.retry(message, error, decision.nextAttemptAt)) ? 'retried' : leaseLost();
    }
    const status = e instanceof PermanentOutboxError ? 'failed' : 'dead';
    if (!(await deps.queue.giveUp(message, error, status, at))) return leaseLost();
    await logDead(deps, message, status, error);
    return 'failed';
  }
}

export interface DrainOutboxResult {
  done: number;
  skipped: number;
  retried: number;
  failed: number;
  /** 処理中にリースが切れ、別のワーカーが取り直していた(結果を書かなかった)数。 */
  lease_lost: number;
}

/** 取れるメッセージが無くなるか、maxMessages 件処理するか、shouldStop が true になるまで1件ずつ処理する。 */
export async function drainOutbox(
  deps: OutboxWorkerDeps,
  options: { maxMessages: number; shouldStop?: () => boolean },
): Promise<DrainOutboxResult> {
  const result: DrainOutboxResult = { done: 0, skipped: 0, retried: 0, failed: 0, lease_lost: 0 };
  for (let i = 0; i < options.maxMessages; i++) {
    if (options.shouldStop?.()) break;
    const outcome = await processNextOutboxMessage(deps);
    if (outcome === 'idle') break;
    result[outcome]++;
  }
  return result;
}
