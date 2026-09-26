import {
  canActForOthers,
  decodeKeysetCursor,
  detectReceiptImageType,
  firstDayOfMonth,
  forbidden,
  invalid,
  isValidYearMonth,
  lastDayOfMonth,
  notFound,
  type ReceiptCancelRefusal,
  type ReceiptImageType,
  receiptCancelRefusal,
  yearMonthOf,
  zonedBusinessDate,
  zonedDayRange,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type {
  ReceiptListFilter,
  ReceiptListPosition,
  ReceiptListRow,
  ReceiptListSummary,
} from '../ports/records';
import type { StoragePort } from '../ports/storage';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface ReceiptListDeps extends Clock {
  uow: UnitOfWorkPort;
  storage: StoragePort;
  appLog: AppLogPort;
}

/** 一覧・CSV の条件。対象スタッフは API が resolveTargetStaffId で決めたもの(一般スタッフは本人)。 */
export interface ReceiptListCriteria {
  yearMonth: string;
  /** true なら全スタッフ分(管理者・コーディネーターだけ)。targetStaffId より優先する。 */
  allStaff: boolean;
  targetStaffId: string;
  customerId?: string | undefined;
}

export interface ReceiptListItemView {
  id: string;
  receiptedAt: string;
  staffId: string;
  staffName: string | null;
  customerId: string | null;
  customerName: string | null;
  amountYen: number | null;
  storeName: string | null;
  companyPaid: boolean;
  handoffText: string | null;
  uploadBatchId: string;
  imageContentType: string;
  imageByteSize: number;
  rowVersion: number;
  cancellation: { cancelledAt: string; cancelledByName: string | null; reason: string | null } | null;
  cancellable: boolean;
}

export interface ReceiptListPage {
  receipts: ReceiptListItemView[];
  nextCursor: string | null;
  yearMonth: string;
  staff: { id: string; name: string } | null;
  summary: ReceiptListSummary & { customerBillableYen: number };
  timeZone: string;
}

interface ResolvedCriteria {
  filter: ReceiptListFilter;
  staff: { id: string; name: string } | null;
  timeZone: string;
  /** 他のスタッフ(または全スタッフ)のデータを読む(操作ログの記録対象)。 */
  crossStaff: boolean;
}

const OTHERS_FORBIDDEN_MESSAGE = '他のスタッフの領収書は見られません。';

/**
 * 一般スタッフは本人の領収書だけ(全スタッフ分・他人の指定は 403 + WARN)。UoW の外で呼ぶ(記録を書くため)。
 * 対象の決定(一般スタッフは常に本人)は API の resolveTargetStaffId が行うが、usecase でも同じ規則を確かめる。
 */
async function assertMayRead(
  deps: ReceiptListDeps,
  actor: Actor,
  criteria: ReceiptListCriteria,
  deniedAction: 'receipt.list.view_denied' | 'receipt.list.export_denied',
  requireOthers: boolean,
): Promise<void> {
  if (canActForOthers(actor.role)) return;
  const others = criteria.allStaff || criteria.targetStaffId !== actor.staffId;
  if (!others && !requireOthers) return;
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'WARN',
    action: deniedAction,
    actorStaffId: actor.staffId,
    targetStaffId:
      criteria.allStaff || criteria.targetStaffId === actor.staffId ? null : criteria.targetStaffId,
    details: { month: criteria.yearMonth, allStaff: criteria.allStaff },
    ...actor.meta,
  });
  throw forbidden(
    requireOthers ? '領収書の CSV は管理者・コーディネーターだけが保存できます。' : OTHERS_FORBIDDEN_MESSAGE,
  );
}

/**
 * 条件を確かめて一覧の絞り込みにする(UoW の中で呼ぶ)。対象スタッフ・お客様が存在しない(他テナントを含む)なら
 * 404。月の境界はテナントのタイムゾーン。
 */
async function resolveCriteria(
  r: TenantRepositories,
  actor: Actor,
  criteria: ReceiptListCriteria,
): Promise<ResolvedCriteria> {
  if (!isValidYearMonth(criteria.yearMonth)) {
    throw invalid('年月の指定が不正です(YYYY-MM形式で指定してください)。');
  }
  const timeZone = (await r.tenant()).timezone;
  let staff: ResolvedCriteria['staff'] = null;
  if (!criteria.allStaff) {
    const found = await r.staff.findById(criteria.targetStaffId);
    if (!found) throw notFound('対象のスタッフが見つかりません。');
    staff = { id: found.id, name: found.displayName };
  }
  if (criteria.customerId && !(await r.customers.findById(criteria.customerId))) {
    throw notFound('顧客が見つかりません');
  }
  return {
    filter: {
      from: zonedDayRange(firstDayOfMonth(criteria.yearMonth), timeZone).from,
      to: zonedDayRange(lastDayOfMonth(criteria.yearMonth), timeZone).to,
      staffId: staff?.id,
      customerId: criteria.customerId,
    },
    staff,
    timeZone,
    crossStaff: criteria.allStaff || staff?.id !== actor.staffId,
  };
}

/** 取消の可否を決めるのに要るもの(今日・締め済みのスタッフ。1回の読み込みで1度だけ作る)。 */
export interface ReceiptCancelContext {
  actor: Pick<Actor, 'staffId' | 'role'>;
  timeZone: string;
  /** 今日(テナントのタイムゾーンの暦日)。 */
  today: string;
  /** 判定する領収書の月('YYYY-MM')。一覧は選んだ月、取消はその領収書の月。 */
  yearMonth: string;
  /** その月の出勤簿が締め済みのスタッフ。 */
  lockedStaffIds: ReadonlySet<string>;
}

/**
 * 判定する領収書の月(yearMonth)の締め済みのスタッフを読み、取消の可否の判定に使う文脈を作る(UoW の中で呼ぶ)。
 * 管理者は前の月の領収書も締めるまでは取消せるため、今日の月ではなく領収書の月の締めを読む。
 */
export async function loadReceiptCancelContext(
  r: TenantRepositories,
  deps: Clock,
  actor: Actor,
  timeZone: string,
  yearMonth: string,
): Promise<ReceiptCancelContext> {
  const today = zonedBusinessDate(currentTime(deps), timeZone);
  const lockedStaffIds = new Set(await r.attendance.listLockedStaffIds(yearMonth));
  return { actor, timeZone, today, yearMonth, lockedStaffIds };
}

/**
 * 領収書を取消せない理由(取消せるなら null)。他人の領収書(一般スタッフ)・取消済み・期間の外
 * (domain/reports/receiptCancel.ts)・領収書の月のそのスタッフの出勤簿が締め済みなら取消せない。
 */
export function receiptCancelBlock(
  row: Pick<ReceiptListRow, 'staffId' | 'receiptedAt' | 'cancelledAt'>,
  ctx: ReceiptCancelContext,
): ReceiptCancelRefusal | 'period_locked' | 'already_cancelled' | 'forbidden' | null {
  if (row.staffId !== ctx.actor.staffId && !canActForOthers(ctx.actor.role)) return 'forbidden';
  if (row.cancelledAt !== null) return 'already_cancelled';
  const receiptDate = zonedBusinessDate(row.receiptedAt, ctx.timeZone);
  const refusal = receiptCancelRefusal({ receiptDate, today: ctx.today, role: ctx.actor.role });
  if (refusal) return refusal;
  if (yearMonthOf(receiptDate) !== ctx.yearMonth) {
    // 締めの一覧は ctx.yearMonth の分だけ(別の月の領収書を判定するのは呼び出し側の誤り)
    throw new Error(`領収書の月 ${yearMonthOf(receiptDate)} は取消の判定の月 ${ctx.yearMonth} と違います`);
  }
  if (ctx.lockedStaffIds.has(row.staffId)) return 'period_locked';
  return null;
}

export function toReceiptListItemView(row: ReceiptListRow, cancellable: boolean): ReceiptListItemView {
  return {
    id: row.id,
    receiptedAt: row.receiptedAt.toISOString(),
    staffId: row.staffId,
    staffName: row.staffName,
    customerId: row.customerId,
    customerName: row.customerId ? row.customerDisplayName : row.customerNameText,
    amountYen: row.amountYen,
    storeName: row.storeName,
    companyPaid: row.companyPaid,
    handoffText: row.handoffText,
    uploadBatchId: row.uploadId,
    imageContentType: row.contentType,
    imageByteSize: row.byteSize,
    rowVersion: row.rowVersion,
    cancellation: row.cancelledAt
      ? {
          cancelledAt: row.cancelledAt.toISOString(),
          cancelledByName: row.cancelledByName,
          reason: row.cancelReason,
        }
      : null,
    cancellable,
  };
}

/** 一覧の続きの位置(不透明な文字列。中身は並びのキー)。 */
export function encodeReceiptCursor(position: ReceiptListPosition): string {
  return Buffer.from(JSON.stringify([position.receiptedAt.toISOString(), position.id]), 'utf8').toString(
    'base64url',
  );
}

export function decodeReceiptCursor(cursor: string): ReceiptListPosition {
  const decoded = decodeKeysetCursor(cursor);
  if (decoded) return { receiptedAt: decoded.at, id: decoded.id };
  throw invalid(
    '続きの位置の指定が正しくありません。最初から読み込み直してください',
    undefined,
    'invalid_cursor',
  );
}

/** 閲覧・ダウンロードの記録(条件と件数だけ。個人情報の値は書かない)。 */
async function logAccess(
  deps: ReceiptListDeps,
  actor: Actor,
  action: 'receipt.list.viewed' | 'receipt.list.exported',
  criteria: ReceiptListCriteria,
  resolved: ResolvedCriteria,
  count: number,
  page: { continued: boolean; pageCount: number } | null = null,
) {
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action,
    actorStaffId: actor.staffId,
    targetStaffId: resolved.staff && resolved.staff.id !== actor.staffId ? resolved.staff.id : null,
    details: {
      month: criteria.yearMonth,
      allStaff: criteria.allStaff,
      ...(criteria.customerId ? { customerId: criteria.customerId } : {}),
      count,
      ...(page ?? {}),
    },
    ...actor.meta,
  });
}

/**
 * 領収書の一覧(領収書日時の新しい順、keyset ページング)と、月全体の件数・合計(GAS版の「領収書一覧」シートの
 * 置き換え)。取消済みの領収書も行としては返し(画面は灰色で出す)、合計には入れない。行ごとに、見ている人が
 * 今取消せるか(cancellable)を付ける。他のスタッフ・全スタッフ分を開いたことを、続きのページも含めて1ページ
 * ごとに操作ログに残す(本人の閲覧は記録しない。CLAUDE.md の Logging の方針)。
 */
export async function listReceipts(
  deps: ReceiptListDeps,
  actor: Actor,
  criteria: ReceiptListCriteria & { cursor?: string | undefined; limit: number },
): Promise<ReceiptListPage> {
  const after = criteria.cursor ? decodeReceiptCursor(criteria.cursor) : null;
  await assertMayRead(deps, actor, criteria, 'receipt.list.view_denied', false);
  const { resolved, rows, summary, cancelContext } = await deps.uow.run(actor.tenantId, async (r) => {
    const resolved = await resolveCriteria(r, actor, criteria);
    const [rows, summary, cancelContext] = await Promise.all([
      r.receipts.list({ ...resolved.filter, includeCancelled: true }, after, criteria.limit + 1),
      r.receipts.summarize(resolved.filter),
      loadReceiptCancelContext(r, deps, actor, resolved.timeZone, criteria.yearMonth),
    ]);
    return { resolved, rows, summary, cancelContext };
  });
  // 他のスタッフ・全スタッフ分は続きのページも毎回残す(続きの位置は書き換えられるため、最初のページだけでは
  // 読んだ範囲を追えない)
  if (resolved.crossStaff) {
    await logAccess(deps, actor, 'receipt.list.viewed', criteria, resolved, summary.count, {
      continued: after !== null,
      pageCount: Math.min(rows.length, criteria.limit),
    });
  }
  const shown = rows.slice(0, criteria.limit);
  const last = shown.at(-1);
  return {
    receipts: shown.map((row) => toReceiptListItemView(row, receiptCancelBlock(row, cancelContext) === null)),
    nextCursor: rows.length > criteria.limit && last ? encodeReceiptCursor(last) : null,
    yearMonth: criteria.yearMonth,
    staff: resolved.staff,
    summary: { ...summary, customerBillableYen: summary.totalYen - summary.companyPaidYen },
    timeZone: resolved.timeZone,
  };
}

/** CSV で1回のトランザクションに読む件数。 */
const EXPORT_BATCH_SIZE = 500;

export interface ReceiptListExport {
  yearMonth: string;
  staff: { id: string; name: string } | null;
  timeZone: string;
  /** 条件に合う取消していない全件(新しい順)。500件ずつ別のトランザクションで読む。 */
  receipts(): AsyncGenerator<ReceiptListItemView[]>;
}

/**
 * 領収書の一覧の CSV(管理者・コーディネーターだけ。取消済みは書き出さない)。条件の検証とダウンロードの記録は
 * 読み始める前に行う(途中で切れても記録は残る)。
 */
export async function exportReceipts(
  deps: ReceiptListDeps,
  actor: Actor,
  criteria: ReceiptListCriteria,
): Promise<ReceiptListExport> {
  await assertMayRead(deps, actor, criteria, 'receipt.list.export_denied', true);
  const { resolved, summary } = await deps.uow.run(actor.tenantId, async (r) => {
    const resolved = await resolveCriteria(r, actor, criteria);
    return { resolved, summary: await r.receipts.summarize(resolved.filter) };
  });
  await logAccess(deps, actor, 'receipt.list.exported', criteria, resolved, summary.count);
  return {
    yearMonth: criteria.yearMonth,
    staff: resolved.staff,
    timeZone: resolved.timeZone,
    async *receipts() {
      let after: ReceiptListPosition | null = null;
      while (true) {
        const rows: ReceiptListRow[] = await deps.uow.run(actor.tenantId, (r) =>
          r.receipts.list({ ...resolved.filter, includeCancelled: false }, after, EXPORT_BATCH_SIZE),
        );
        if (rows.length > 0) yield rows.map((row) => toReceiptListItemView(row, false));
        const last = rows.at(-1);
        if (rows.length < EXPORT_BATCH_SIZE || !last) return;
        after = last;
      }
    },
  };
}

export interface ReceiptImage {
  contentType: ReceiptImageType;
  bytes: Uint8Array;
}

/**
 * 領収書の画像(本人の領収書、管理者・コーディネーターは全員の領収書)。一般スタッフが他人の領収書を開こうと
 * したら 403(WARN)。画像の種類は保存時と同じく中身の先頭バイトで判定し直す(画像以外を配信しない)。
 * ファイル置き場の読み込みは UoW の外で行う。一覧の閲覧を記録するため、1枚ごとの閲覧は記録しない
 * (サムネイルの表示のたびに記録が増えるため)。
 */
export async function getReceiptImage(
  deps: ReceiptListDeps,
  actor: Actor,
  receiptId: string,
): Promise<ReceiptImage> {
  const ref = await deps.uow.run(actor.tenantId, (r) => r.receipts.findImage(receiptId));
  if (!ref) throw notFound('領収書が見つかりません。');
  if (ref.staffId !== actor.staffId && !canActForOthers(actor.role)) {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'WARN',
      action: 'receipt.image.view_denied',
      actorStaffId: actor.staffId,
      targetStaffId: ref.staffId,
      details: { receiptId },
      ...actor.meta,
    });
    throw forbidden(OTHERS_FORBIDDEN_MESSAGE);
  }
  const bytes = await deps.storage.get(ref.storageKey);
  const contentType = bytes ? detectReceiptImageType(bytes) : null;
  if (!bytes || !contentType) {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'WARN',
      action: 'receipt.image.unavailable',
      actorStaffId: actor.staffId,
      targetStaffId: ref.staffId === actor.staffId ? null : ref.staffId,
      details: { receiptId, reason: bytes ? 'unsupported_type' : 'missing' },
      ...actor.meta,
    });
    throw notFound('領収書の画像が見つかりません。');
  }
  return { contentType, bytes };
}
