import { newId } from '@katahimo/core/domain';
import type { CryptoPort, UnitOfWorkPort } from '@katahimo/core/ports';
import { applyCustomerSnapshot, type CustomerSnapshotIssue } from '@katahimo/core/usecases';
import { toCustomerSnapshot } from './toCustomerSnapshot';
import type { ReservaCsvRow } from './types';

/** 取込データから消えた顧客がアーカイブ前の顧客のこの割合を超えたら、自動適用せず人手の確認を求める。 */
export const DEFAULT_REVIEW_THRESHOLD = 0.2;

export interface ReservaImportPlan {
  toCreate: ReservaCsvRow[];
  toUpdate: ReservaCsvRow[];
  /** 取込データに存在しなくなった(アーカイブ前の)顧客の ID。 */
  toArchiveCustomerIds: string[];
  stats: {
    existingActiveCount: number;
    incomingCount: number;
    createCount: number;
    updateCount: number;
    archiveCount: number;
    /** 消失 / 既存(アーカイブ前)。既存0件なら0。 */
    missingRatio: number;
  };
  requiresReview: boolean;
}

/**
 * 取込の差分を計算する(書き込まない)。氏名ではなく取込元の ID(RESERVA の顧客ID)で突き合わせる。
 * 旧GAS版(CsvImport.js updateDatabaseFromLinesV2)の「丸ごと置き換え」は踏襲しない。
 * 安全装置の対象は「消失」の割合だけ(更新は日次の取込でも大量に起きる正常な挙動のため含めない)。
 */
export function planReservaImport(
  existing: ReadonlyMap<string, { customerId: string; archived: boolean }>,
  rows: ReservaCsvRow[],
  reviewThreshold: number = DEFAULT_REVIEW_THRESHOLD,
): ReservaImportPlan {
  const incoming = new Set(rows.map((r) => r.customerId));
  const toCreate = rows.filter((r) => !existing.has(r.customerId));
  const toUpdate = rows.filter((r) => existing.has(r.customerId));
  const active = [...existing].filter(([, link]) => !link.archived);
  const toArchiveCustomerIds = active
    .filter(([externalId]) => !incoming.has(externalId))
    .map(([, l]) => l.customerId);
  const missingRatio = active.length > 0 ? toArchiveCustomerIds.length / active.length : 0;
  return {
    toCreate,
    toUpdate,
    toArchiveCustomerIds,
    stats: {
      existingActiveCount: active.length,
      incomingCount: rows.length,
      createCount: toCreate.length,
      updateCount: toUpdate.length,
      archiveCount: toArchiveCustomerIds.length,
      missingRatio,
    },
    requiresReview: active.length > 0 && missingRatio > reviewThreshold,
  };
}

export interface ReservaImportDeps {
  uow: UnitOfWorkPort;
  crypto: CryptoPort;
  now?: () => Date;
}

export interface ReservaImportOptions {
  /** 消失の割合が閾値を超えても適用する(内容を確認した管理者の明示の操作)。 */
  force?: boolean;
  fileName?: string | null;
  fileVersion?: string | null;
  triggeredBy?: string | null;
  reviewThreshold?: number;
}

export type ReservaImportOutcome =
  | {
      status: 'applied';
      runId: string;
      plan: ReservaImportPlan;
      created: number;
      updated: number;
      unchanged: number;
      archived: number;
      /** 取込元の値の誤りで取り込まなかった行。 */
      skipped: number;
      /** 取込元の値の誤りの数(直して取り込んだ行・飛ばした行の理由ごと)。 */
      issues: Partial<Record<CustomerSnapshotIssue, number>>;
      customerDataVersion: number;
    }
  | { status: 'review_required'; runId: string; plan: ReservaImportPlan };

/**
 * 顧客CSVの行を1トランザクションで適用する: 差分の計算 → 作成・変わった項目だけの更新(ID を保つ)→
 * 消えた顧客のアーカイブ(reason = import_missing)→ 変わっていれば顧客データの版数を上げる(予定計算のキャッシュを作り直す)。
 * 行の値の誤り(住所2の期間の逆転等)は書く前に直すか、その行だけ飛ばして数を import_runs.counts に残す
 * (1行の誤りで取込全体を止めない)。実行は import_runs に残す(安全装置で止めた場合も review_required として残す)。
 */
export async function applyReservaImport(
  deps: ReservaImportDeps,
  tenantId: string,
  rows: ReservaCsvRow[],
  options: ReservaImportOptions = {},
): Promise<ReservaImportOutcome> {
  const runId = newId();
  const now = deps.now?.() ?? new Date();
  return deps.uow.run(
    tenantId,
    async (r) => {
      await r.importRuns.start({
        id: runId,
        source: 'reserva_csv',
        fileName: options.fileName ?? null,
        fileVersion: options.fileVersion ?? null,
        triggeredBy: options.triggeredBy ?? null,
      });
      const plan = planReservaImport(
        await r.customerSourceRecords.mapExternalIds('reserva'),
        rows,
        options.reviewThreshold,
      );
      if (plan.requiresReview && !options.force) {
        await r.importRuns.finish(runId, {
          status: 'review_required',
          counts: { ...plan.stats, missingRatio: Math.round(plan.stats.missingRatio * 1000) / 1000 },
          message: `取込データから消えた顧客が多すぎます(消失${plan.stats.archiveCount}件 / 既存${plan.stats.existingActiveCount}件)`,
        });
        return { status: 'review_required' as const, runId, plan };
      }
      const counts = { created: 0, updated: 0, unchanged: 0, archived: 0, skipped: 0 };
      const issues: Partial<Record<CustomerSnapshotIssue, number>> = {};
      const onIssue = (issue: CustomerSnapshotIssue) => {
        issues[issue] = (issues[issue] ?? 0) + 1;
      };
      for (const row of rows) {
        const outcome = await applyCustomerSnapshot(
          { crypto: deps.crypto, runId, onIssue },
          r,
          toCustomerSnapshot(row),
          now,
        );
        counts[outcome]++;
      }
      for (const customerId of plan.toArchiveCustomerIds) {
        await r.customers.archive(customerId, 'import_missing', now);
        counts.archived++;
      }
      // 何も変わらなければ版数を上げない(画面・予定計算のキャッシュを無駄に読み直させない)
      const changed = counts.created + counts.updated + counts.archived > 0;
      const customerDataVersion = changed
        ? await r.settings.bumpCustomerDataVersion()
        : (await r.settings.get()).customerDataVersion;
      const issueCounts = Object.fromEntries(
        Object.entries(issues).map(([issue, n]) => [`issue_${issue}`, n]),
      );
      await r.importRuns.finish(runId, {
        status: 'applied',
        counts: { ...counts, ...issueCounts },
        message: null,
      });
      return { status: 'applied' as const, runId, plan, ...counts, issues, customerDataVersion };
    },
    { actorId: options.triggeredBy ?? null },
  );
}
