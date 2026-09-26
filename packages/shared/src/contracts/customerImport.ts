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
  /** 同じテナントの他の顧客の取込(外部連携の API 等)が実行中で、ロックを待ちきれなかった(送り直せば通る) */
  'busy',
  'failed',
]);
export type CustomerCsvImportStatus = z.infer<typeof customerCsvImportStatusSchema>;

// ── 取込元の設定(platform.tenants.customer_import_settings。運用担当者の `pnpm tenant:customer-source`) ──

/** Google Drive のフォルダID(フォルダの URL の /folders/ の後ろ)。 */
export const driveFolderIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{10,200}$/, 'Google Drive のフォルダID(英数字・「-」「_」)を指定してください');

/**
 * テナントの顧客データの取込元。provider で取込元の種類を分ける(今は RESERVA の顧客CSVを置く Drive のフォルダだけ)。
 * 設定の無いテナント(jsonb が `{}`)は自動取込の対象外。
 */
export const tenantCustomerImportSettingsSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('reserva_csv'), driveFolderId: driveFolderIdSchema }),
]);
export type TenantCustomerImportSettings = z.infer<typeof tenantCustomerImportSettingsSchema>;

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
