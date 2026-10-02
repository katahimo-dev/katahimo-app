import { z } from 'zod';
import { staffRoleSchema } from './roles';

/** ログイン画面に出すデモ用アカウント(`publicLogin` のときだけ返す)。 */
export const demoAccountViewSchema = z.object({
  role: staffRoleSchema,
  /** 役割の名前(管理者・コーディネーター・スタッフ)。 */
  label: z.string(),
  email: z.string(),
});
export type DemoAccountView = z.infer<typeof demoAccountViewSchema>;

/**
 * GET /api/demo/config(ログイン不要)。公開デモの表示の設定。API の環境変数(`DEMO_TENANT_SLUG` 等)から作り、
 * web はビルドの設定ではなくこれを見て、ログイン画面の注意書き・デモ用アカウント、ログイン直後の注釈、
 * 「デモ環境」の帯を出す(本番とデモで同じイメージを使うため)。デモの制限そのものは API が掛ける。
 */
export const demoConfigResponseSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    /** デモ用テナントの slug。ログイン画面でこの会社IDが入っているときに注意書きを出す。 */
    tenantSlug: z.string(),
    /**
     * デモ専用の環境か(`DEMO_PUBLIC_LOGIN=true`)。true ならログイン画面の既定の会社IDをデモ用テナントにし、
     * デモ用アカウントとパスワードを出す。本番の環境に暫定でデモ用テナントを置くときは false(本番の利用者に出さない)。
     */
    publicLogin: z.boolean(),
    /** デモ用アカウント(publicLogin が false なら空)。 */
    accounts: z.array(demoAccountViewSchema),
    /** デモ用アカウントの共通のパスワード(publicLogin が false なら null)。 */
    password: z.string().nullable(),
    /**
     * 訪問者の入力を保存する日数(`DEMO_DATA_RETENTION_DAYS`。作り直しのジョブが前日分を日付付きのテナントで残す期間)。
     * null = 期間を約束しない(本番の環境に暫定でデモ用テナントを置き、毎晩の作り直しも無いとき。画面は「毎晩作り直す」
     * 「◯日間」と言わず、保存することだけを伝える)。デモ専用の環境(publicLogin)では未設定でも 30。
     */
    dataRetentionDays: z.number().int().positive().nullable(),
    /**
     * 操作ログ・接続情報(IPアドレス等)を保存する月数(`DEMO_LOG_RETENTION_MONTHS`)。
     * null = 期間を約束しない(本番の操作ログは本番の保存期間に従うため、明示して設定したときだけ出す)。
     * デモ専用の環境(publicLogin)では未設定でも 3。
     */
    logRetentionMonths: z.number().int().positive().nullable(),
    /** 1回のログインで使える AI の回数。 */
    aiUsesPerSession: z.number().int().positive(),
  }),
]);
export type DemoConfigResponse = z.infer<typeof demoConfigResponseSchema>;
