import { z } from 'zod';
import { idSchema } from './common';

/**
 * 「これまでの記録」(GET /api/reports/history?customerId=&before=)の応答。
 * GAS版 Main.js getCustomerReports の戻り値と同じ項目名(packages/core の HistoryItem)。
 * 1回に5件まで、新しい順。次の5件は before に前の応答の nextCursor を渡して読む(キーセットページング)。
 */
export const customerHistoryItemSchema = z.object({
  type: z.enum(['daily', 'accident']),
  id: idSchema,
  /** 記録日時(ISO8601)。 */
  occurredAtIso: z.string(),
  /** 表示用 'yyyy/MM/dd HH:mm'(JST)。 */
  timestamp: z.string(),
  staff: z.string(),
  /** 書いたメモ */
  original: z.string(),
  /** 事務局に送る文 */
  internal: z.string(),
  /** 保護者に送る文(事故報告は保護者への対応) */
  customer: z.string(),
  /** PSI(1〜5)。日報のみ */
  risk: z.number().nullish(),
  /** ES(1〜5)。日報のみ */
  es: z.number().nullish(),
  isAccident: z.boolean().optional(),
  /** 事故報告の種類('事故報告' / 'ヒヤリハット') */
  subtype: z.string().optional(),
});
export type CustomerHistoryItem = z.infer<typeof customerHistoryItemSchema>;

export const customerHistoryResponseSchema = z.object({
  items: z.array(customerHistoryItemSchema),
  /** 続きがあれば次の before に渡す値(不透明な文字列)。無ければ null。 */
  nextCursor: z.string().nullable(),
});

export const customerHistoryQuerySchema = z.object({
  customerId: idSchema,
  /** 前の応答の nextCursor。 */
  before: z.string().max(200).optional(),
});
export type CustomerHistoryResponse = z.infer<typeof customerHistoryResponseSchema>;
