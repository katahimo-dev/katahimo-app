import { z } from 'zod';

/** APIエラーの共通形。HTTPステータスとは別に、クライアントが分岐できる機械可読なコードを持たせる。 */
export const apiErrorSchema = z.object({
  code: z.enum([
    'unauthenticated',
    'forbidden',
    'not_found',
    'validation_failed',
    'conflict',
    'rate_limited',
    'internal',
  ]),
  message: z.string(),
  /** バリデーション失敗時のフィールド別メッセージ */
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** 全テナントスコープのリソースが持つ識別子。UUID v4 を想定。 */
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
