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

/** 'YYYY-MM' 形式の対象月。 */
export const yearMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM 形式で指定してください');

/** 'HH:MM' 形式の時刻。出勤簿の時刻セルはこの形で正規化して扱う。 */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 形式で指定してください');

/** `{ ok: true }` だけを返すAPI(POST /api/auth/logout 等)の応答。 */
export const okResponseSchema = z.object({ ok: z.literal(true) });
