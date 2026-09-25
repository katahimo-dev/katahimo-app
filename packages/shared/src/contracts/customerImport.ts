import { z } from 'zod';

/**
 * 顧客CSV(RESERVA「Kokyaku_YYYYMMDDHHmm_N.csv」)の自動取込
 * (GAS版 CsvImport.js の checkAndImportLatestCsv / forceImportCsv / checkDataVersion)。
 */

export const customerCsvImportStatusSchema = z.enum([
  /** 取込元が設定されていない(このテナントは自動取込の対象外) */
  'not_configured',
  /** 取込元フォルダに該当ファイルが無い */
  'no_files',
  /** 最新ファイルは取込済み */
  'up_to_date',
  'imported',
  /** 消失率が安全装置の閾値を超えたため適用しなかった(人手の確認が必要) */
  'review_required',
  'failed',
]);
export type CustomerCsvImportStatus = z.infer<typeof customerCsvImportStatusSchema>;

// ── POST /api/admin/customers/import(管理者のみ) ────────────

export const customerCsvImportRequestSchema = z.object({
  /** true(既定)なら取込済みの版でも取り込み直す(GAS版 forceImportCsv)。 */
  force: z.boolean().default(true),
});

export const customerCsvImportResponseSchema = z.object({
  status: customerCsvImportStatusSchema,
  message: z.string(),
  fileName: z.string().nullable(),
  /** ファイル名の YYYYMMDDHHmm 部分。 */
  version: z.string().nullable(),
  stats: z
    .object({
      created: z.number().int(),
      updated: z.number().int(),
      archived: z.number().int(),
      existingActiveCount: z.number().int(),
      incomingCount: z.number().int(),
      missingRatio: z.number(),
    })
    .nullable(),
  dataVersion: z.string(),
});
export type CustomerCsvImportResponse = z.infer<typeof customerCsvImportResponseSchema>;

// ── GET /api/data-version ────────────────────────────────────

/** 顧客データの版数。クライアントは60秒ごとにポーリングし、変わっていたら再読込する。 */
export const dataVersionResponseSchema = z.object({
  dataVersion: z.string(),
});
