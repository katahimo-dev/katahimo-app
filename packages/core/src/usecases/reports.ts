import { isPsiAlert } from '@katahimo/shared';
import {
  addIsoDays,
  buildAccidentHistoryInternalText,
  buildAccidentReportNotificationText,
  buildDailyReportNotificationText,
  buildPsiAlertChatText,
  buildPsiAlertNotice,
  CARE_RECORD_BODY_SCHEMA_VERSION,
  canActForOthers,
  conflict,
  DomainError,
  decodeHistoryCursor,
  encodeHistoryCursor,
  forbidden,
  formatJstDateTimeShort,
  invalid,
  newId,
  notFound,
  outboxDedupeKey,
  parseCareRecordBody,
  parseTimeToMinutes,
  psiAlertTopic,
  recordTypeOfAccidentReport,
  reportTypeLabelOf,
  resolveTargetStaffId,
  zonedBusinessDate,
  zonedInstant,
} from '../domain';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { AppLogPort } from '../ports/appLog';
import type { NotifierPort } from '../ports/notifier';
import type { CareRecordRow } from '../ports/records';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import { notifyWithLog } from './notify';
import { enqueueForSubscriptions } from './pushNotifications';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface ReportDeps extends Clock {
  uow: UnitOfWorkPort;
  notifier: NotifierPort;
  appLog: AppLogPort;
}

/** 保存・上書きの共通入力。担当スタッフはクライアントの申告ではなく actor と既存の記録から決める。 */
interface SaveReportCommon {
  /** 他のスタッフの名義で保存する場合(管理者・コーディネーターのみ有効。一般スタッフが送っても無視する)。 */
  requestedStaffId?: string | undefined;
  /** 既存の記録の上書き(GAS版の rowIndex 指定に相当)。 */
  reportId?: string | undefined;
  /** 上書きのとき、画面が読んだ記録の版(送れば、他の人が先に保存していた場合に 409 conflict)。 */
  rowVersion?: number | undefined;
  customerId: string;
}

interface ResolvedWrite {
  existing: CareRecordRow | null;
  authorStaffId: string;
  staffName: string;
  customerName: string;
  timeZone: string;
  retentionDays: number;
}

/**
 * 保存先の担当スタッフを決め、上書きの権限と整合を確かめる(CLAUDE.md の admin-vs-self)。
 * - 他人を扱えないロール: 常に本人。上書きは本人の記録に限る(GAS版は行番号さえ分かれば他人の日報を上書き
 *   できた穴を塞ぐ)。
 * - 上書きでは記録の顧客・担当スタッフを変えない(別の顧客・担当の記録IDで上書きすると中身が入れ替わる)。
 *   違えば 409 conflict。担当の指定を省略した上書きは元の担当のまま。
 */
async function resolveWrite(
  r: TenantRepositories,
  actor: Actor,
  kind: 'daily' | 'accident',
  input: SaveReportCommon,
): Promise<ResolvedWrite> {
  let existing: CareRecordRow | null = null;
  if (input.reportId) {
    existing = await r.careRecords.findById(input.reportId);
    const matchesKind = existing && (kind === 'daily') === (existing.recordType === 'daily_report');
    if (!existing || !matchesKind) throw notFound('修正対象の報告が見つかりません', 'report_not_found');
    if (!canActForOthers(actor.role) && existing.authorStaffId !== actor.staffId) {
      throw forbidden('他のスタッフの報告は修正できません', 'forbidden');
    }
    if (existing.customerId !== input.customerId) {
      throw conflict(
        '別のお客様の報告は上書きできません。画面を開きなおしてください',
        undefined,
        'customer_mismatch',
      );
    }
    const requested = canActForOthers(actor.role) ? input.requestedStaffId?.trim() : undefined;
    if (requested && requested !== existing.authorStaffId) {
      throw conflict(
        '担当スタッフの異なる報告は上書きできません。画面を開きなおしてください',
        undefined,
        'author_mismatch',
      );
    }
  }
  const authorStaffId = existing?.authorStaffId ?? resolveTargetStaffId(actor, input.requestedStaffId);
  const [staff, customer, tenant, settings] = await Promise.all([
    r.staff.findById(authorStaffId),
    r.customers.findById(input.customerId),
    r.tenant(),
    r.settings.get(),
  ]);
  if (!staff) throw notFound('スタッフが見つかりません', 'staff_not_found');
  if (!customer) throw notFound('顧客が見つかりません', 'customer_not_found');
  return {
    existing,
    authorStaffId,
    staffName: staff.displayName,
    customerName: customer.displayName,
    timeZone: tenant.timezone,
    retentionDays: settings.careRecordRetentionDays,
  };
}

async function logDenied(
  deps: ReportDeps,
  actor: Actor,
  kind: string,
  input: SaveReportCommon,
  error: unknown,
) {
  if (!(error instanceof DomainError)) return;
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: error.code === 'forbidden' ? 'SECURITY' : 'WARN',
    action: `report.${kind}.save_denied`,
    actorStaffId: actor.staffId,
    details: {
      reason: error.reason ?? error.code,
      reportId: input.reportId ?? null,
      customerId: input.customerId,
    },
    ...actor.meta,
  });
}

/**
 * 記録を書く(新規は insert、上書きは update。上書きで本文が変わるとトリガーが変更前を履歴に残す)。
 * スプレッドシートへのミラーを同じトランザクションで積む(版ごとに1回)。
 */
async function persist(
  r: TenantRepositories,
  write: ResolvedWrite,
  record: Omit<CareRecordRow, 'id' | 'rowVersion' | 'status' | 'retainUntil'>,
  rowVersion: number | undefined,
): Promise<CareRecordRow> {
  const id = write.existing?.id ?? newId();
  const { body, ...fields } = record;
  const retainUntil = addIsoDays(zonedBusinessDate(record.occurredAt, write.timeZone), write.retentionDays);
  const saved = write.existing
    ? await r.careRecords.update(
        id,
        {
          recordType: fields.recordType,
          occurredAt: fields.occurredAt,
          servicePeriod: fields.servicePeriod,
          careRecipientId: fields.careRecipientId,
          riskRating: fields.riskRating,
          esRating: fields.esRating,
          body,
          bodySchemaVer: CARE_RECORD_BODY_SCHEMA_VERSION,
        },
        rowVersion,
      )
    : await r.careRecords.insert({ ...fields, id, status: 'submitted', body, retainUntil });
  await r.outbox.enqueue({
    topic: 'mirror.care_record',
    aggregateType: 'care_record',
    aggregateId: saved.id,
    dedupeKey: outboxDedupeKey('mirror.care_record', saved.id, saved.rowVersion),
  });
  return saved;
}

async function logSaved(
  deps: ReportDeps,
  actor: Actor,
  kind: string,
  saved: CareRecordRow,
  created: boolean,
) {
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: `report.${kind}.saved`,
    actorStaffId: actor.staffId,
    targetStaffId: saved.authorStaffId === actor.staffId ? null : saved.authorStaffId,
    details: { reportId: saved.id, customerId: saved.customerId, mode: created ? 'create' : 'update' },
    ...actor.meta,
  });
}

export interface SaveDailyReportInput extends SaveReportCommon {
  /** 'YYYY-MM-DD'。省略時は保存時刻を記録日時にする(GAS版 saveReport と同じ)。 */
  reportDate?: string | undefined;
  startTime: string;
  endTime: string;
  inputText: string;
  internalText: string;
  customerText: string;
  riskRating: number | null;
  esRating: number | null;
  /** 日報の対象のお子様(お客様の世帯の子。違えば 400)。 */
  careRecipientId?: string | null | undefined;
  /** 下書きを作った AI 生成の記録(同じスタッフ・同じお客様の生成だけ。違えば 400)。 */
  aiGenerationId?: string | undefined;
}

export interface DailyReportView {
  id: string;
  occurredAt: Date;
  staffId: string;
  customerId: string;
  riskRating: number | null;
  esRating: number | null;
  careRecipientId: string | null;
  /** PSI 2 以下で保存したため管理者へ知らせた。 */
  psiAlert: boolean;
  rowVersion: number;
  content: DailyReportContent;
}

/** 対象のお子様がお客様の世帯の子か確かめる(アーカイブされた子も、前に書いた日報の上書きのため認める)。 */
async function assertCareRecipientOf(r: TenantRepositories, customerId: string, careRecipientId: string) {
  const recipients = await r.careRecipients.listByCustomer(customerId, { includeArchived: true });
  if (!recipients.some((c) => c.id === careRecipientId)) {
    throw invalid(
      '対象のお子様がこのお客様の世帯にいません。画面を開きなおしてください',
      { careRecipientId: '対象のお子様が正しくありません' },
      'care_recipient_mismatch',
    );
  }
}

/**
 * 結び付ける AI 生成の記録を確かめる: このテナントの記録で、同じお客様・同じスタッフ(生成した人 = 保存する人)が
 * 作った成功した生成であること、別の日報に結び付いていないこと(同じ日報の保存し直しは認める)。
 */
async function resolveAiGeneration(
  r: TenantRepositories,
  actor: Actor,
  input: SaveDailyReportInput,
  existingId: string | null,
) {
  if (!input.aiGenerationId) return null;
  const generation = await r.reportAiGenerations.findById(input.aiGenerationId);
  if (
    !generation ||
    generation.customerId !== input.customerId ||
    generation.staffId !== actor.staffId ||
    generation.errorCode !== null
  ) {
    throw invalid(
      'AIの下書きの記録がこの日報と合いません。もう一度AIに書いてもらってください',
      undefined,
      'ai_generation_mismatch',
    );
  }
  if (generation.careRecordId && generation.careRecordId !== existingId) {
    throw conflict(
      'このAIの下書きは別の日報で保存済みです。画面を開きなおしてください',
      undefined,
      'ai_generation_linked',
    );
  }
  return generation;
}

/** PSI の知らせを、在籍している管理者の全ての端末に積む(記録の版ごとに1回)。積んだ数。 */
async function enqueuePsiAlerts(
  r: TenantRepositories,
  saved: CareRecordRow,
  write: ResolvedWrite,
  date: string,
  now: Date,
): Promise<number> {
  if (!isPsiAlert(saved.riskRating)) return 0;
  const today = zonedBusinessDate(now, write.timeZone);
  const admins = (await r.staff.listActiveOn(today)).filter((s) => s.role === 'admin');
  const notice = buildPsiAlertNotice({
    recordId: saved.id,
    riskRating: saved.riskRating as number,
    staffName: write.staffName,
    customerName: write.customerName,
    date,
  });
  let count = 0;
  for (const admin of admins) {
    const subscriptions = await r.pushSubscriptions.listForStaff(admin.id);
    await enqueueForSubscriptions(r, 'push.psi_alert', subscriptions, `${saved.id}:${saved.rowVersion}`, {
      notice,
      expiresAt: new Date(now.getTime() + PSI_ALERT_VALID_MS).toISOString(),
      topic: psiAlertTopic(saved.id),
    });
    count += subscriptions.length;
  }
  return count;
}

/** 管理者への PSI の知らせを端末に届けるまで待つ時間(過ぎたら送らない)。 */
const PSI_ALERT_VALID_MS = 24 * 60 * 60 * 1000;

function servicePeriodOf(date: string | undefined, start: string, end: string, timeZone: string) {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (!date || s === null || e === null) return null;
  return { start: zonedInstant(date, s, timeZone), end: zonedInstant(date, e <= s ? e + 1440 : e, timeZone) };
}

/**
 * 保育日報を保存する(GAS版 Main.js saveReport)。保存・ミラーの積み込みは1トランザクション、成功後に
 * Google Chat へ通知する(通知の失敗で保存は失敗にしない)。
 */
export async function saveDailyReport(
  deps: ReportDeps,
  actor: Actor,
  input: SaveDailyReportInput,
): Promise<DailyReportView> {
  const content: DailyReportContent = {
    startTime: input.startTime,
    endTime: input.endTime,
    inputText: input.inputText,
    internalText: input.internalText,
    customerText: input.customerText,
  };
  const now = currentTime(deps);
  let result: { saved: CareRecordRow; write: ResolvedWrite; date: string; pushQueued: number };
  try {
    result = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const write = await resolveWrite(r, actor, 'daily', input);
        if (input.careRecipientId) await assertCareRecipientOf(r, input.customerId, input.careRecipientId);
        const generation = await resolveAiGeneration(r, actor, input, write.existing?.id ?? null);
        const startMinutes = parseTimeToMinutes(input.startTime);
        const occurredAt = input.reportDate
          ? zonedInstant(input.reportDate, startMinutes ?? 0, write.timeZone)
          : now;
        const saved = await persist(
          r,
          write,
          {
            recordType: 'daily_report',
            visitId: null,
            customerId: input.customerId,
            careRecipientId: input.careRecipientId ?? null,
            authorStaffId: write.authorStaffId,
            occurredAt,
            servicePeriod: servicePeriodOf(input.reportDate, input.startTime, input.endTime, write.timeZone),
            riskRating: input.riskRating,
            esRating: input.esRating,
            bodySchemaVer: CARE_RECORD_BODY_SCHEMA_VERSION,
            body: content,
          },
          input.rowVersion,
        );
        if (generation) await r.reportAiGenerations.linkToCareRecord(generation.id, saved.id);
        const date = input.reportDate ?? zonedBusinessDate(occurredAt, write.timeZone);
        const pushQueued = await enqueuePsiAlerts(r, saved, write, date, now);
        return { saved, write, date, pushQueued };
      },
      { actorId: actor.staffId },
    );
  } catch (error) {
    await logDenied(deps, actor, 'daily', input, error);
    throw error;
  }
  const { saved, write } = result;
  await notifyWithLog(
    deps,
    actor.tenantId,
    'report',
    buildDailyReportNotificationText({
      staffName: write.staffName,
      customerName: write.customerName,
      content,
      riskRating: input.riskRating,
      esRating: input.esRating,
    }),
    actor.staffId,
  );
  const psiAlert = isPsiAlert(saved.riskRating);
  if (psiAlert) {
    await notifyWithLog(
      deps,
      actor.tenantId,
      'report',
      buildPsiAlertChatText({
        recordId: saved.id,
        riskRating: saved.riskRating as number,
        staffName: write.staffName,
        customerName: write.customerName,
        date: result.date,
      }),
      actor.staffId,
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'WARN',
      action: 'report.psi_alert',
      actorStaffId: actor.staffId,
      targetStaffId: saved.authorStaffId === actor.staffId ? null : saved.authorStaffId,
      details: {
        reportId: saved.id,
        customerId: saved.customerId,
        riskRating: saved.riskRating,
        rowVersion: saved.rowVersion,
        pushQueued: result.pushQueued,
      },
      ...actor.meta,
    });
  }
  await logSaved(deps, actor, 'daily', saved, !write.existing);
  return {
    id: saved.id,
    occurredAt: saved.occurredAt,
    staffId: saved.authorStaffId,
    customerId: saved.customerId,
    riskRating: saved.riskRating,
    esRating: saved.esRating,
    careRecipientId: saved.careRecipientId,
    psiAlert,
    rowVersion: saved.rowVersion,
    content,
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
  rowVersion: number;
  content: AccidentReportContent;
}

/**
 * 事故報告/ヒヤリハットを保存する(GAS版 Main.js saveAccidentReport)。記録日時は常に保存した時刻(GAS版と同じく
 * 上書きでも保存時刻になる)。上書きで事故報告とヒヤリハットを切り替えられる(GAS版も同じ行の種別の列を書き換えた)。
 * 日報との切り替えはできない(上書きの対象が見つからない扱い)。
 */
export async function saveAccidentReport(
  deps: ReportDeps,
  actor: Actor,
  input: SaveAccidentReportInput,
): Promise<AccidentReportView> {
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
  const recordType = recordTypeOfAccidentReport(input.reportType);
  const now = currentTime(deps);
  let result: { saved: CareRecordRow; write: ResolvedWrite };
  try {
    result = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const write = await resolveWrite(r, actor, 'accident', input);
        const saved = await persist(
          r,
          write,
          {
            recordType,
            visitId: null,
            customerId: input.customerId,
            careRecipientId: null,
            authorStaffId: write.authorStaffId,
            occurredAt: now,
            servicePeriod: null,
            riskRating: null,
            esRating: null,
            bodySchemaVer: CARE_RECORD_BODY_SCHEMA_VERSION,
            body: content,
          },
          input.rowVersion,
        );
        return { saved, write };
      },
      { actorId: actor.staffId },
    );
  } catch (error) {
    await logDenied(deps, actor, 'accident', input, error);
    throw error;
  }
  const { saved, write } = result;
  const reportType = reportTypeLabelOf(recordType);
  await notifyWithLog(
    deps,
    actor.tenantId,
    'report',
    buildAccidentReportNotificationText({
      staffName: write.staffName,
      customerName: write.customerName,
      reportType,
      content,
    }),
    actor.staffId,
  );
  await logSaved(deps, actor, 'accident', saved, !write.existing);
  return {
    id: saved.id,
    occurredAt: saved.occurredAt,
    staffId: saved.authorStaffId,
    customerId: saved.customerId,
    reportType,
    rowVersion: saved.rowVersion,
    content,
  };
}

export interface SendVisitCompleteInput {
  requestedStaffId?: string | undefined;
  customerId: string;
  /** 'YYYY-MM-DD' */
  visitDate: string;
  startTime: string;
  endTime: string;
}

/**
 * 「訪問完了」の通知だけを送る(DB には書かない。GAS版 sendVisitComplete)。担当者名・顧客名はクライアントの
 * 指定を信用せず、セッションと DB から決める。
 */
export async function sendVisitCompleteNotification(
  deps: ReportDeps,
  actor: Actor,
  input: SendVisitCompleteInput,
): Promise<void> {
  const staffId = resolveTargetStaffId(actor, input.requestedStaffId);
  const names = await deps.uow.run(actor.tenantId, async (r) => {
    const [staff, customer] = await Promise.all([
      r.staff.findById(staffId),
      r.customers.findById(input.customerId),
    ]);
    return staff && customer ? { staff: staff.displayName, customer: customer.displayName } : null;
  });
  if (!names) throw notFound('顧客またはスタッフが見つかりません');
  const dateStr = input.visitDate.replaceAll('-', '/');
  const message = `【訪問完了】\n担当: ${names.staff}\n顧客名: ${names.customer}\n訪問日時: ${dateStr} ${input.startTime}〜${input.endTime}`;
  await notifyWithLog(deps, actor.tenantId, 'report', message, actor.staffId);
}

export interface HistoryItem {
  type: 'daily' | 'accident';
  id: string;
  occurredAtIso: string;
  /** 表示用 'yyyy/MM/dd HH:mm'。GAS版 getCustomerReports の fmt() と同じ書式。 */
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

export interface CustomerHistoryPage {
  items: HistoryItem[];
  /** 続きがあれば次のページの位置(不透明な文字列)。無ければ null。 */
  nextCursor: string | null;
}

/**
 * 顧客の活動記録(日報+事故報告)を新しい順に取得する(GAS版 Main.js getCustomerReports)。並びは
 * (occurred_at DESC, id DESC) で、続きは cursor(前のページの nextCursor)から読む(キーセットページング。
 * 同じ時刻の記録があっても重複・抜けが無い)。
 */
export async function getCustomerHistory(
  deps: ReportDeps,
  actor: Actor,
  customerId: string,
  cursor: string | null,
  limit = 5,
): Promise<CustomerHistoryPage> {
  const after = cursor ? decodeHistoryCursor(cursor) : null;
  if (cursor && !after)
    throw invalid('続きの位置(before)が正しくありません', { before: '続きの位置が正しくありません' });
  const { rows, staffNames } = await deps.uow.run(actor.tenantId, async (r) => {
    const rows = await r.careRecords.listByCustomer(customerId, after, limit + 1);
    const staffIds = [...new Set(rows.map((row) => row.authorStaffId))];
    const staffNames = new Map<string, string>();
    for (const id of staffIds) {
      const staff = await r.staff.findById(id);
      if (staff) staffNames.set(id, staff.displayName);
    }
    return { rows, staffNames };
  });
  const page = rows.slice(0, limit);
  const items: HistoryItem[] = [];
  for (const row of page) {
    const body = parseCareRecordBody(row.recordType, row.body, row.bodySchemaVer);
    const base = {
      id: row.id,
      occurredAtIso: row.occurredAt.toISOString(),
      timestamp: formatJstDateTimeShort(row.occurredAt),
      staff: staffNames.get(row.authorStaffId) ?? '',
    };
    if (body.recordType === 'daily_report') {
      items.push({
        ...base,
        type: 'daily',
        original: body.content.inputText,
        internal: body.content.internalText,
        customer: body.content.customerText,
        risk: row.riskRating,
        es: row.esRating,
      });
    } else {
      items.push({
        ...base,
        type: 'accident',
        original: body.content.inputText,
        internal: buildAccidentHistoryInternalText(body.content),
        customer: body.content.parentCorrespondence,
        isAccident: true,
        subtype: reportTypeLabelOf(body.recordType),
      });
    }
  }
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeHistoryCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
  };
}
