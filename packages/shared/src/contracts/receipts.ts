import { z } from 'zod';
import { businessDateSchema, idSchema, timeOfDaySchema } from './common';

/** 'yyyy/MM/dd HH:mm' または 'yyyy/MM/dd HH:mm:ss'(JST)。GAS版の領収書日時の書式。 */
export const receiptTimestampSchema = z
  .string()
  .regex(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(:\d{2})?$/, 'yyyy/MM/dd HH:mm[:ss] 形式で指定してください');

export const receiptImageUploadSchema = z.object({
  /** data URL('data:image/jpeg;base64,...') */
  data: z.string().min(1),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  storeName: z.string().nullable().optional(),
  /** OCR等で得た領収書日時。空なら下記のフォールバック日時を使う。 */
  receiptDate: z
    .union([receiptTimestampSchema, z.literal('')])
    .nullable()
    .optional(),
});

/**
 * POST /api/receipts
 * - customerIdを省略/nullにすると「お客様の指定なし」の領収書(GAS版openStandaloneReceiptModal)。
 *   その場合customerNameTextに未登録のお客様の氏名を入れられる(任意)。
 * - 領収書日時が画像ごとに無い場合のフォールバックは、receiptTimestamp → reportDate+startTime
 *   → 登録時刻の順に決める(GAS版buildReceiptTimestampは日報の訪問日+開始時刻)。
 * - staffIdは管理者のみ有効。
 */
export const uploadReceiptsRequestSchema = z.object({
  staffId: idSchema.optional(),
  customerId: idSchema.nullable().optional(),
  customerNameText: z.string().trim().max(200).optional(),
  images: z.array(receiptImageUploadSchema).min(1, '領収書画像がありません。'),
  receiptTimestamp: receiptTimestampSchema.optional(),
  reportDate: businessDateSchema.optional(),
  startTime: timeOfDaySchema.optional(),
  handoffText: z.string().default(''),
});
export type UploadReceiptsRequest = z.infer<typeof uploadReceiptsRequestSchema>;

export const receiptDuplicateSchema = z.object({
  index: z.number().int(),
  timestamp: z.string(),
  amount: z.string(),
  storeName: z.string(),
});

export const uploadReceiptsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  uploadedCount: z.number().int(),
  duplicateCount: z.number().int(),
  duplicates: z.array(receiptDuplicateSchema),
  /** 今回の登録で採番したバッチID(1件も登録されなかった場合はnull)。 */
  uploadBatchId: idSchema.nullable(),
});
export type UploadReceiptsResponse = z.infer<typeof uploadReceiptsResponseSchema>;
