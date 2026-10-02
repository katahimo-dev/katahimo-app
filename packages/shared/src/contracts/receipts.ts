import { z } from 'zod';
import {
  freeText,
  idSchema,
  isRecordDate,
  RECORD_YEAR_MAX,
  RECORD_YEAR_MIN,
  recordDateSchema,
  timeOfDaySchema,
  yearMonthSchema,
} from './common';

/** 'yyyy/MM/dd HH:mm' または 'yyyy/MM/dd HH:mm:ss'(JST)。GAS版の領収書日時の書式。 */
export const receiptTimestampSchema = z
  .string()
  .regex(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}(:\d{2})?$/, 'yyyy/MM/dd HH:mm[:ss] 形式で指定してください')
  .refine((value) => {
    const [year, month, day] = value.slice(0, 10).split('/').map(Number) as [number, number, number];
    return isRecordDate(year, month, day);
  }, `${RECORD_YEAR_MIN}〜${RECORD_YEAR_MAX}年の実在する日付を指定してください`);

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

/** 領収書1枚の金額の上限(円)。DB の integer に収め、桁の打ち間違いを止める。 */
export const RECEIPT_AMOUNT_MAX_YEN = 10_000_000;
/** 金額の入力(文字)の長さ・店名・事務局へのひとことの文字数の上限。 */
export const RECEIPT_AMOUNT_TEXT_MAX_LENGTH = 20;
export const RECEIPT_STORE_NAME_MAX_LENGTH = 200;
export const RECEIPT_HANDOFF_MAX_LENGTH = 2000;
const RECEIPT_AMOUNT_TOO_LARGE = `金額は${RECEIPT_AMOUNT_MAX_YEN.toLocaleString('ja-JP')}円以下で入力してください。`;

/**
 * 金額の入力を円の整数にする(「1,200」「1200円」「¥1,200」等。全角の数字は読まない)。読めない・負・上限
 * (RECEIPT_AMOUNT_MAX_YEN)を超える値は null。
 */
export function parseReceiptAmountYen(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[,，\s円¥￥]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  const yen = Math.round(n);
  return yen <= RECEIPT_AMOUNT_MAX_YEN ? yen : null;
}

/** 上限を超える金額か(読めない値は登録で金額なしになるため、ここでは断らない)。 */
function exceedsReceiptAmountMax(value: string | number): boolean {
  const n = Number(String(value).replace(/[,，\s円¥￥]/g, ''));
  return Number.isFinite(n) && Math.round(n) > RECEIPT_AMOUNT_MAX_YEN;
}

const receiptAmountInputSchema = z
  .union([
    z
      .string()
      .max(
        RECEIPT_AMOUNT_TEXT_MAX_LENGTH,
        `金額は${RECEIPT_AMOUNT_TEXT_MAX_LENGTH}文字以内で入力してください。`,
      ),
    z.number(),
  ])
  .refine((value) => !exceedsReceiptAmountMax(value), RECEIPT_AMOUNT_TOO_LARGE);

export const receiptImageUploadSchema = z.object({
  /** data URL('data:image/jpeg;base64,...')。JPEG・PNG・WebP のみ。 */
  data: imageDataSchema,
  amount: receiptAmountInputSchema.nullable().optional(),
  storeName: freeText(
    z
      .string()
      .max(
        RECEIPT_STORE_NAME_MAX_LENGTH,
        `お店の名前は${RECEIPT_STORE_NAME_MAX_LENGTH}文字以内で入力してください。`,
      )
      .nullable()
      .optional(),
  ),
  /**
   * OCR等で得た領収書日時。GAS版と同じく表記は問わない('2026/9/5 9:05'・日付だけ等も可)。重複判定には文字列の
   * まま使い、日時として読めなければ下記のフォールバック日時で記録する。空なら下記のフォールバック日時を使う。
   */
  receiptDate: freeText(z.string().trim().max(50).nullable().optional()),
  /**
   * 会社負担(研修等の同行・会社の都合で出た駐車場代など。お客様に請求しない)。スタッフへの支払いは同じ。
   * 登録の後は変えられない(直すときは取消して登録し直す)。
   */
  companyPaid: z.boolean().default(false),
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
  customerNameText: freeText(z.string().trim().max(200).optional()),
  images: z
    .array(receiptImageUploadSchema)
    .min(1, '領収書画像がありません。')
    .max(RECEIPT_MAX_IMAGES, `領収書画像は${RECEIPT_MAX_IMAGES}枚までです。`),
  receiptTimestamp: receiptTimestampSchema.optional(),
  reportDate: recordDateSchema.optional(),
  startTime: timeOfDaySchema.optional(),
  handoffText: freeText(
    z
      .string()
      .max(
        RECEIPT_HANDOFF_MAX_LENGTH,
        `事務局へのひとことは${RECEIPT_HANDOFF_MAX_LENGTH}文字以内で入力してください。`,
      )
      .default(''),
  ),
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

// ── 領収書の一覧・画像(GET /api/receipts・/api/receipts/csv・/api/receipts/:id/image) ──

/** 一覧の1ページの件数の上限。 */
export const RECEIPT_LIST_MAX_PAGE_SIZE = 200;

/**
 * GET /api/receipts・GET /api/receipts/csv の条件。
 * - month: 領収書日時の月(テナントのタイムゾーン)
 * - staffId: 管理者・コーディネーターだけが有効な対象スタッフ(一般スタッフが送っても本人に固定される)
 * - allStaff: 'true' で全スタッフ分(管理者・コーディネーターだけ。一般スタッフは 403)。staffId より優先
 * - customerId: お客様で絞り込む(上の対象の中で)
 * - cursor: 前のページの nextCursor(一覧だけ。CSV は条件に合う全件)
 */
export const receiptListQuerySchema = z.object({
  month: yearMonthSchema,
  staffId: idSchema.optional(),
  allStaff: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  customerId: idSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(RECEIPT_LIST_MAX_PAGE_SIZE).default(50),
});
export type ReceiptListQuery = z.input<typeof receiptListQuerySchema>;

/** 領収書の区分の表示(CSV・Excel の「区分」の列の値。画面の「会社負担」の印も同じ言葉)。 */
export const RECEIPT_BILLING_LABELS = { customer: 'お客様請求', company: '会社負担' } as const;

export function receiptBillingLabel(companyPaid: boolean): string {
  return companyPaid ? RECEIPT_BILLING_LABELS.company : RECEIPT_BILLING_LABELS.customer;
}

/** 取消の理由の長さの上限(1行。DB の receipts_cancel_reason_check と同じ)。 */
export const RECEIPT_CANCEL_REASON_MAX_LENGTH = 100;

/** 取消の情報(取消していない領収書は null)。 */
export const receiptCancellationSchema = z.object({
  /** 取消の日時(ISO8601・UTC)。 */
  cancelledAt: z.string(),
  /** 取消したスタッフの氏名(削除されたスタッフは null)。 */
  cancelledByName: z.string().nullable(),
  /** 取消の理由(入力が無ければ null)。 */
  reason: z.string().nullable(),
});

/** 領収書1件(一覧の行)。 */
export const receiptListItemSchema = z.object({
  id: idSchema,
  /** 領収書日時(ISO8601・UTC)。画面ではテナントのタイムゾーンで表示する。 */
  receiptedAt: z.string(),
  staffId: idSchema,
  /** 担当スタッフの氏名(削除されたスタッフは null)。 */
  staffName: z.string().nullable(),
  customerId: idSchema.nullable(),
  /** お客様の表示名(登録済みのお客様はその名前、未登録は入力された氏名、指定なしは null)。 */
  customerName: z.string().nullable(),
  /** 金額(円)。読めなかった・未入力は null。 */
  amountYen: z.number().int().nullable(),
  storeName: z.string().nullable(),
  /** 会社負担(お客様に請求しない)。 */
  companyPaid: z.boolean(),
  /** 登録の束(1回の送信)の申し送り。束の全ての領収書に同じ値が入る。 */
  handoffText: z.string().nullable(),
  /** 登録の束のID(同じ回に送った領収書は同じ値)。 */
  uploadBatchId: idSchema,
  /** 画像の種類(image/jpeg・image/png・image/webp)。画像は GET /api/receipts/:id/image。 */
  imageContentType: z.string(),
  imageByteSize: z.number().int(),
  /** 取消(POST /api/receipts/:id/cancel)に送る版。 */
  rowVersion: z.number().int().positive(),
  /** 取消済みなら取消の情報(一覧には灰色で残る。合計・CSV・Excel には入らない)。 */
  cancellation: receiptCancellationSchema.nullable(),
  /** 今、見ている人が取消せるか(サーバーが本人・役割・期間・締めで決める。false なら「取消」を出さない)。 */
  cancellable: z.boolean(),
});
export type ReceiptListItem = z.infer<typeof receiptListItemSchema>;

/** GET /api/receipts(領収書日時の新しい順)。 */
export const receiptListResponseSchema = z.object({
  receipts: z.array(receiptListItemSchema),
  /** 次のページの cursor(最後のページは null)。 */
  nextCursor: z.string().nullable(),
  yearMonth: yearMonthSchema,
  /** 対象スタッフ(全スタッフ分のときは null)。 */
  staff: z.object({ id: idSchema, name: z.string() }).nullable(),
  /**
   * 条件に合う取消していない全件(ページではなく月全体)の件数・金額の合計(金額が無いものは0円。会社負担を含む
   * スタッフへの支払いの額)・うち会社負担・お客様に請求する額・金額の無い件数と、取消済みの件数。
   */
  summary: z.object({
    count: z.number().int(),
    totalYen: z.number().int(),
    companyPaidYen: z.number().int(),
    customerBillableYen: z.number().int(),
    noAmountCount: z.number().int(),
    cancelledCount: z.number().int(),
  }),
  /** テナントのタイムゾーン(表示用)。 */
  timeZone: z.string(),
});
export type ReceiptListResponse = z.infer<typeof receiptListResponseSchema>;

// ── 領収書の取消(POST /api/receipts/:id/cancel) ──

/**
 * 取消(論理削除)。理由は任意の1行(改行・制御文字は空白にして前後の空白を除く。空なら理由なし)。rowVersion は
 * 一覧の行の版(違えば 409)。
 */
export const cancelReceiptRequestSchema = z.object({
  reason: z
    .string()
    .transform((value) => value.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim())
    .pipe(
      z
        .string()
        .max(
          RECEIPT_CANCEL_REASON_MAX_LENGTH,
          `取消の理由は${RECEIPT_CANCEL_REASON_MAX_LENGTH}文字までで入力してください`,
        ),
    )
    .optional(),
  rowVersion: z.number().int().positive(),
});
export type CancelReceiptRequest = z.input<typeof cancelReceiptRequestSchema>;

/** 取消した後の一覧の行。 */
export const cancelReceiptResponseSchema = z.object({ receipt: receiptListItemSchema });
export type CancelReceiptResponse = z.infer<typeof cancelReceiptResponseSchema>;
