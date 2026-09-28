import { DomainError, notFound } from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { CustomerReportProfileRecord } from '../ports/reportAi';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor } from './requestMeta';

/**
 * 家庭ごとの教育思考★(customer_report_profiles)。顧客の取込(RESERVA の CSV・外部連携の API)が書き換える
 * customers とは別の表に持つ(取込で消えない「こちら側の判断」)。ログインしているスタッフなら誰でも見られ・
 * 変えられる(お客様の詳細・日報のダイアログ)。変更は操作ログに残す。
 */
export interface CustomerReportProfileDeps {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

export interface CustomerReportProfileView {
  customerId: string;
  educationLevel: number | null;
  rowVersion: number | null;
  updatedAt: Date | null;
  updatedByName: string | null;
}

async function viewOf(
  r: TenantRepositories,
  customerId: string,
  record: CustomerReportProfileRecord | null,
): Promise<CustomerReportProfileView> {
  const updatedBy = record?.updatedBy ? await r.staff.findById(record.updatedBy) : null;
  return {
    customerId,
    educationLevel: record?.educationLevel ?? null,
    rowVersion: record?.rowVersion ?? null,
    updatedAt: record?.updatedAt ?? null,
    updatedByName: updatedBy?.displayName ?? null,
  };
}

export async function getCustomerReportProfile(
  deps: CustomerReportProfileDeps,
  actor: Actor,
  customerId: string,
): Promise<CustomerReportProfileView> {
  return deps.uow.run(actor.tenantId, async (r) => {
    const customer = await r.customers.findById(customerId);
    if (!customer) throw notFound('お客様が見つかりません', 'customer_not_found');
    return viewOf(r, customerId, await r.customerReportProfiles.find(customerId));
  });
}

/**
 * 教育思考★を変える。educationLevel の null は未設定に戻す(行は消さずに null を書くので、row_version・更新者・
 * 操作ログは★を付けるときと同じに続く。行の無い家庭を未設定にしても null の行を作るだけ)。未設定の家庭の日報は
 * 行が無い家庭と同じく★2(DEFAULT_EDUCATION_LEVEL)。rowVersion は画面が読んだ版(行の無い家庭は省略)。
 * その間に他の人が変えていれば 409。INFO `customer.report_profile.updated`(前後の★。未設定は null)。
 */
export async function saveCustomerReportProfile(
  deps: CustomerReportProfileDeps,
  actor: Actor,
  customerId: string,
  input: { educationLevel: number | null; rowVersion?: number | undefined },
): Promise<CustomerReportProfileView> {
  let before: number | null = null;
  let view: CustomerReportProfileView;
  try {
    view = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const customer = await r.customers.findById(customerId);
        if (!customer) throw notFound('お客様が見つかりません', 'customer_not_found');
        before = (await r.customerReportProfiles.find(customerId))?.educationLevel ?? null;
        const saved = await r.customerReportProfiles.save(
          customerId,
          input.educationLevel,
          actor.staffId,
          input.rowVersion,
        );
        return viewOf(r, customerId, saved);
      },
      { actorId: actor.staffId },
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === 'conflict') {
      await deps.appLog.write({
        tenantId: actor.tenantId,
        level: 'WARN',
        action: 'customer.report_profile.update_rejected',
        actorStaffId: actor.staffId,
        details: { customerId, reason: error.reason ?? error.code },
        ...actor.meta,
      });
    }
    throw error;
  }
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'INFO',
    action: 'customer.report_profile.updated',
    actorStaffId: actor.staffId,
    details: { customerId, from: before, to: input.educationLevel },
    ...actor.meta,
  });
  return view;
}
