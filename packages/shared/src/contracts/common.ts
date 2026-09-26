import { z } from 'zod';

/** APIエラーの共通形。HTTPステータスとは別に、クライアントが分岐できる機械可読なコードを持たせる。 */
export const apiErrorSchema = z.object({
  code: z.enum([
    'unauthenticated',
    'forbidden',
    'not_found',
    'validation_failed',
    'conflict',
    /** 月ロック等、期限切れで変更できない */
    'locked',
    'rate_limited',
    /** 外部サービス(カレンダー・GAS Bridge等)から結果を得られなかった */
    'upstream_unavailable',
    'internal',
  ]),
  message: z.string(),
  /** バリデーション失敗時のフィールド別メッセージ */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** リソースの識別子(UUID。アプリが UUIDv7 で採番する)。 */
export const idSchema = z.string().uuid();

/** 'YYYY-MM-DD' 形式の日付文字列(JST基準の業務日)。 */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください');
export type BusinessDate = z.infer<typeof businessDateSchema>;

/**
 * 記録の日付(日報の訪問日・領収書の日時)として書き込める年の範囲。これ外の年は入力・OCR の誤りとして扱う
 * (一覧の続きの位置・月ごとの集計に、業務であり得ない年を持ち込まない)。
 */
export const RECORD_YEAR_MIN = 2000;
export const RECORD_YEAR_MAX = 2100;

/** 年月日が実在し、記録として書き込める年の範囲(RECORD_YEAR_MIN〜RECORD_YEAR_MAX)にあるか。 */
export function isRecordDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < RECORD_YEAR_MIN || year > RECORD_YEAR_MAX) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

const RECORD_DATE_MESSAGE = `${RECORD_YEAR_MIN}〜${RECORD_YEAR_MAX}年の実在する日付を指定してください`;

/** 書き込む記録の日付('YYYY-MM-DD'。実在する日付で、年は RECORD_YEAR_MIN〜RECORD_YEAR_MAX)。 */
export const recordDateSchema = businessDateSchema.refine((value) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return isRecordDate(year, month, day);
}, RECORD_DATE_MESSAGE);

/** 'YYYY-MM' 形式の対象月。 */
export const yearMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM 形式で指定してください');

/** 'HH:MM' 形式の時刻。出勤簿の時刻セルはこの形で正規化して扱う。 */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 形式で指定してください');

/** `{ ok: true }` だけを返すAPI(POST /api/auth/logout 等)の応答。 */
export const okResponseSchema = z.object({ ok: z.literal(true) });

/**
 * タブ・改行・復帰以外の C0 制御文字(U+0000〜U+001F)。PostgreSQL の text / jsonb は U+0000 を保存できず、
 * 他の制御文字も画面・シートに出す値として意味を持たないため、自由記述の入力と取込の値から取り除く。
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を取り除くための正規表現
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** 制御文字(タブ・改行・復帰以外)を取り除く。 */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

/** 自由記述の欄のスキーマ。検証したあとで制御文字(タブ・改行・復帰以外)を取り除く。 */
export function freeText<T extends z.ZodType<string | null | undefined, z.ZodTypeDef, unknown>>(schema: T) {
  return schema.transform((value: z.output<T>) =>
    typeof value === 'string' ? (stripControlChars(value) as z.output<T>) : value,
  );
}
