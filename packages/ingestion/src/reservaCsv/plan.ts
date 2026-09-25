import type { CustomerRepositoryPort } from '@katahimo/core/ports';
import type { CustomerDeps } from '@katahimo/core/usecases';
import { createCustomer, deactivateCustomer, updateCustomer } from '@katahimo/core/usecases';
import { mapReservaRowToCustomerInput, RESERVA_EXTERNAL_SOURCE } from './mapToCustomerInput';
import type { ReservaCsvRow } from './types';

/** 既存件数のこの割合を超える変更(更新+消失)があれば、自動適用せず人手のレビューを求める。 */
const DEFAULT_REVIEW_THRESHOLD = 0.2;

export interface ReservaImportPlan {
  toCreate: ReservaCsvRow[];
  toUpdate: ReservaCsvRow[];
  /** 取込データに存在しなくなった顧客の外部ID。適用時にソフトデリートする。 */
  toDeactivateExternalIds: string[];
  stats: {
    existingActiveCount: number;
    incomingCount: number;
    createCount: number;
    updateCount: number;
    deactivateCount: number;
    /** (更新+消失) / 既存件数。ゼロ除算回避のため既存0件なら0。 */
    changedRatio: number;
  };
  /** trueの場合、applyReservaImportPlanは例外を投げて適用を拒否する(人手のレビューが必要)。 */
  requiresReview: boolean;
}

/**
 * RESERVA CSVの取込差分を計算する(DBへの書き込みは一切行わない、読み取り専用の計画)。
 *
 * 氏名の文字列一致ではなく、外部ID(RESERVAの顧客ID)による突き合わせで
 * 作成/更新/消失(ソフトデリート対象)を判定する(doc/07 第5章・第8章の方針)。
 * 「取込データで既存データを丸ごと置き換える」旧GAS版の危険な挙動(CsvImport.jsの
 * updateDatabaseFromLinesV2)は踏襲せず、差分適用+安全装置付きにする。
 */
export async function planReservaImport(
  customers: CustomerRepositoryPort,
  tenantId: string,
  rows: ReservaCsvRow[],
  reviewThreshold: number = DEFAULT_REVIEW_THRESHOLD,
): Promise<ReservaImportPlan> {
  const existingIds = new Set(await customers.listActiveExternalIds(tenantId, RESERVA_EXTERNAL_SOURCE));
  const incomingIds = new Set(rows.map((r) => r.customerId));

  const toCreate = rows.filter((r) => !existingIds.has(r.customerId));
  const toUpdate = rows.filter((r) => existingIds.has(r.customerId));
  const toDeactivateExternalIds = [...existingIds].filter((id) => !incomingIds.has(id));

  const existingActiveCount = existingIds.size;
  // 閾値の対象は「消失(取込データに存在しなくなった=データ損失リスク)」の割合のみとする。
  // 「更新」は安定した顧客基盤で日次取込するだけでもほぼ毎回大量に発生する正常な挙動であり、
  // これを閾値に含めると通常運用のたびに毎回レビュー待ちになってしまい安全装置として機能しない。
  const changedRatio = existingActiveCount > 0 ? toDeactivateExternalIds.length / existingActiveCount : 0;

  return {
    toCreate,
    toUpdate,
    toDeactivateExternalIds,
    stats: {
      existingActiveCount,
      incomingCount: rows.length,
      createCount: toCreate.length,
      updateCount: toUpdate.length,
      deactivateCount: toDeactivateExternalIds.length,
      changedRatio,
    },
    requiresReview: existingActiveCount > 0 && changedRatio > reviewThreshold,
  };
}

export interface ApplyReservaImportResult {
  created: number;
  updated: number;
  deactivated: number;
}

/**
 * 取込計画をDBに適用する。requiresReview=trueの計画は明示的にforce=trueを渡さない限り拒否する
 * (安全装置。想定外に欠損したCSVを誤って適用しないため)。
 */
export async function applyReservaImportPlan(
  deps: CustomerDeps,
  tenantId: string,
  plan: ReservaImportPlan,
  options: { force?: boolean } = {},
): Promise<ApplyReservaImportResult> {
  if (plan.requiresReview && !options.force) {
    throw new Error(
      `取込データから消失した顧客の割合が閾値を超えています(消失率 ${(plan.stats.changedRatio * 100).toFixed(1)}%: ` +
        `消失${plan.stats.deactivateCount}件 / 既存${plan.stats.existingActiveCount}件)。` +
        'CSVの欠損等が無いか内容を確認し、問題なければ { force: true } を指定して再実行してください。',
    );
  }

  for (const row of plan.toCreate) {
    await createCustomer(deps, mapReservaRowToCustomerInput(tenantId, row));
  }

  for (const row of plan.toUpdate) {
    const existing = await deps.customers.findByExternalId(tenantId, RESERVA_EXTERNAL_SOURCE, row.customerId);
    if (!existing) continue;
    await updateCustomer(deps, tenantId, existing.id, mapReservaRowToCustomerInput(tenantId, row));
  }

  for (const externalId of plan.toDeactivateExternalIds) {
    const existing = await deps.customers.findByExternalId(tenantId, RESERVA_EXTERNAL_SOURCE, externalId);
    if (existing) await deactivateCustomer(deps, tenantId, existing.id);
  }

  return {
    created: plan.toCreate.length,
    updated: plan.toUpdate.length,
    deactivated: plan.toDeactivateExternalIds.length,
  };
}
