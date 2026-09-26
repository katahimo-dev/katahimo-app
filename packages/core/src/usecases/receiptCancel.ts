import { formatZonedDateTime } from '@katahimo/shared';
import {
  buildReceiptCancelNotificationText,
  conflict,
  DomainError,
  forbidden,
  notFound,
  RECEIPT_CANCEL_REFUSAL_MESSAGES,
  STALE_WRITE_MESSAGE,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { NotifierPort } from '../ports/notifier';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import { notifyWithLog } from './notify';
import {
  loadReceiptCancelContext,
  type ReceiptListItemView,
  receiptCancelBlock,
  toReceiptListItemView,
} from './receiptList';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';

export interface ReceiptCancelDeps extends Clock {
  uow: UnitOfWorkPort;
  notifier: NotifierPort;
  appLog: AppLogPort;
}

export interface CancelReceiptInput {
  receiptId: string;
  /** 取消の理由(前後の空白・改行は contract で整えたもの)。空なら理由なし。 */
  reason?: string | undefined;
  /** 一覧で読んだ版。 */
  rowVersion: number;
}

const OTHERS_FORBIDDEN_MESSAGE = '他のスタッフの領収書は取消せません。';
const ALREADY_CANCELLED_MESSAGE = 'この領収書はもう取消されています。画面を読み込み直してください。';

/**
 * 領収書の取消(論理削除。GAS版には無い)。行は消さずに取消の日時・取消した人・理由を入れ、一覧には灰色で残し、
 * 合計・CSV・Excel・重複の判定から除く。直すときは取消して登録し直す(編集はしない)。
 *
 * - 本人の領収書は本人が、他のスタッフの領収書は管理者・コーディネーターが取消せる(一般スタッフは 403 + WARN)。
 * - 取消せる期間は domain/reports/receiptCancel.ts(管理者は今月の分ならいつでも、他はその日+2日までで月の
 *   最終日を除く)。期間の外・締め済みの月は 400 locked + WARN `receipt.cancel_refused`。
 * - 取消済みは 409(already_cancelled)、版が違えば 409(stale_row_version)。
 * - 取消したら INFO `receipt.cancelled` を残し、領収書の通知先(Google Chat)へ知らせる。スプレッドシートへの
 *   ミラーには送らない(ミラーは登録だけを写す。doc/05 §9)。
 */
export async function cancelReceipt(
  deps: ReceiptCancelDeps,
  actor: Actor,
  input: CancelReceiptInput,
): Promise<ReceiptListItemView> {
  const reason = input.reason?.trim() || null;
  const outcome = await deps.uow.run(
    actor.tenantId,
    async (r) => {
      const row = await r.receipts.findListRow(input.receiptId);
      if (!row) throw notFound('領収書が見つかりません。');
      const timeZone = (await r.tenant()).timezone;
      const context = await loadReceiptCancelContext(r, deps, actor, timeZone);
      const block = receiptCancelBlock(row, context);
      // 断った記録は UoW の外で書く(ロールバックで消えないように)
      if (block === 'forbidden') return { kind: 'forbidden' as const, row };
      if (block === 'already_cancelled')
        throw conflict(ALREADY_CANCELLED_MESSAGE, undefined, 'already_cancelled');
      if (block !== null) return { kind: 'refused' as const, row, block };
      if (row.rowVersion !== input.rowVersion) {
        throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
      }
      await r.receipts.cancel(
        row.id,
        { cancelledAt: currentTime(deps), cancelledBy: actor.staffId, cancelReason: reason },
        input.rowVersion,
      );
      const updated = await r.receipts.findListRow(row.id);
      if (!updated) throw notFound('領収書が見つかりません。');
      return { kind: 'cancelled' as const, row: updated, timeZone };
    },
    { actorId: actor.staffId },
  );

  const targetStaffId = outcome.row.staffId === actor.staffId ? null : outcome.row.staffId;
  if (outcome.kind === 'forbidden') {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'WARN',
      action: 'receipt.cancel_denied',
      actorStaffId: actor.staffId,
      targetStaffId,
      details: { receiptId: input.receiptId },
      ...actor.meta,
    });
    throw forbidden(OTHERS_FORBIDDEN_MESSAGE);
  }
  if (outcome.kind === 'refused') {
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'WARN',
      action: 'receipt.cancel_refused',
      actorStaffId: actor.staffId,
      targetStaffId,
      details: { receiptId: input.receiptId, reason: outcome.block },
      ...actor.meta,
    });
    throw new DomainError('locked', RECEIPT_CANCEL_REFUSAL_MESSAGES[outcome.block], undefined, outcome.block);
  }

  const row = outcome.row;
  await notifyWithLog(
    deps,
    actor.tenantId,
    'receipt',
    buildReceiptCancelNotificationText({
      staffName: row.staffName ?? '',
      cancelledByName: targetStaffId ? row.cancelledByName : null,
      customerName: row.customerId ? row.customerDisplayName : row.customerNameText,
      // 'yyyy/MM/dd HH:mm'(登録の通知の日付と同じ区切り)
      receiptTimestamp: formatZonedDateTime(row.receiptedAt, outcome.timeZone)
        .slice(0, 16)
        .replaceAll('-', '/'),
      image: {
        amount: row.amountYen === null ? '' : String(row.amountYen),
        storeName: row.storeName ?? '',
        companyPaid: row.companyPaid,
      },
      reason,
    }),
    actor.staffId,
  );
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'receipt.cancelled',
    actorStaffId: actor.staffId,
    targetStaffId,
    details: { receiptId: row.id, uploadBatchId: row.uploadId, withReason: reason !== null },
    ...actor.meta,
  });
  return toReceiptListItemView(row, false);
}
