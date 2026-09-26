import { z } from 'zod';
import { businessDateSchema, idSchema, timeOfDaySchema } from './common';

/** 'yyyy/MM/dd HH:mm' または 'yyyy/MM/dd HH:mm:ss'(JST)。GAS版の領収書日時の書式。 */
export const receiptTimestampSchema = z
  .string()
  .regex(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(:\d{2})?$/, 'yyyy/MM/dd HH:mm[:ss] 形式で指定してください');

/** 1回の登録で送れる領収書画像の枚数(GAS版と同じ6枚)。 */
export const RECEIPT_MAX_IMAGES = 6;
/**
 * 領収書画像1枚の大きさの上限(デコード後のバイト数)。画面は長い辺1200px・JPEG品質0.7に縮めてから送るため
 * 通常は数百KB。種類は JPEG・PNG・WebP だけ(サーバーが中身の先頭バイトで判定する)。
 */
export const RECEIPT_IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
/** data URL の文字数の上限(base64 は4/3倍、接頭辞の分の余裕を足す)。 */
const RECEIPT_IMAGE_DATA_URL_MAX_LENGTH = Math.ceil((RECEIPT_IMAGE_MAX_BYTES * 4) / 3) + 100;
const imageDataSchema = z
  .string()
  .min(1, '領収書画像がありません。')
  .max(RECEIPT_IMAGE_DATA_URL_MAX_LENGTH, '領収書画像が大きすぎます。');

export const receiptImageUploadSchema = z.object({
  /** data URL('data:image/jpeg;base64,...')。JPEG・PNG・WebP のみ。 */
  data: imageDataSchema,
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  storeName: z.string().nullable().optional(),
  /**
   * OCR等で得た領収書日時。GAS版と同じく表記は問わない('2026/9/5 9:05'・日付だけ等も可)。重複判定には文字列の
   * まま使い、日時として読めなければ下記のフォールバック日時で記録する。空なら下記のフォールバック日時を使う。
   */
  receiptDate: z.string().trim().max(50).nullable().optional(),
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
  images: z
    .array(receiptImageUploadSchema)
    .min(1, '領収書画像がありません。')
    .max(RECEIPT_MAX_IMAGES, `領収書画像は${RECEIPT_MAX_IMAGES}枚までです。`),
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

/** POST /api/receipts/ocr(領収書1枚から金額・店名・日時を読む。GAS版 extractAmountFromImage) */
export const receiptOcrRequestSchema = z.object({
  image: z
    .string()
    .min(1, 'image が必要です')
    .max(RECEIPT_IMAGE_DATA_URL_MAX_LENGTH, '領収書画像が大きすぎます。'),
});
export type ReceiptOcrRequest = z.infer<typeof receiptOcrRequestSchema>;

/**
 * 読み取れなかった項目は空文字。receiptDate は 'yyyy/MM/dd HH:mm'。OCRの呼び出し自体が失敗したときは
 * error に理由が入る(値は空のまま。手入力で続けられるようにするため)。
 */
export const receiptOcrResultSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  storeName: z.string(),
  receiptDate: z.string(),
  error: z.string().optional(),
});
export type ReceiptOcrResult = z.infer<typeof receiptOcrResultSchema>;
export const receiptOcrResponseSchema = z.object({ result: receiptOcrResultSchema });
