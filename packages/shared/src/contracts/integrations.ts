import { z } from 'zod';
import { freeText } from './common';

/**
 * 外部システムからの顧客の受け取り(POST /api/integrations/customers。RESERVA 等との連携の受け口)。
 * 認証は API キー(`Authorization: Bearer kth_…`。運用担当者が `pnpm tenant:api-keys` で発行する)で、
 * Cookie のセッションは使わない。テナントと書ける取込元(customer_source_records.source)はキーで決まる。
 *
 * 1件は「その顧客の今の全ての値」(取込元の形式を知らない形。顧客CSVの1行と同じ扱い): 省いた・null の項目は空にする。
 * 受け取るのは作成・更新(upsert)だけで、削除・アーカイブはしない(送られなかった顧客はそのまま)。
 */

/** 1回に送れる顧客の数。 */
export const INTEGRATION_CUSTOMERS_MAX_PER_REQUEST = 500;

/** 実在する 'YYYY-MM-DD'(DB の date に入らない値でトランザクション全体を失敗させない)。 */
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で指定してください')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, '存在しない日付です');

/** 省略可能な短い文字列(空文字は null)。 */
const optionalText = (max: number) =>
  freeText(z.string().trim().max(max, `${max}文字以内で指定してください`).nullish()).transform(
    (value) => value || null,
  );

const addressSchema = z
  .object({
    addressLine: freeText(z.string().trim().min(1, '住所を指定してください').max(300)),
    prefecture: optionalText(20),
    city: optionalText(100),
    parkingArea: optionalText(200),
    parkingDetail: optionalText(1000),
    lat: z.number().min(-90).max(90).nullish(),
    lng: z.number().min(-180).max(180).nullish(),
  })
  .refine((a) => (a.lat == null) === (a.lng == null), {
    message: '緯度と経度は両方指定してください',
    path: ['lat'],
  });

const secondaryAddressSchema = addressSchema
  .and(
    z.object({
      /** 期間限定の住所の適用開始日・終了日(両端を含む)。 */
      validFrom: calendarDateSchema.nullish(),
      validTo: calendarDateSchema.nullish(),
    }),
  )
  .refine((a) => !a.validFrom || !a.validTo || a.validFrom <= a.validTo, {
    message: '住所2の適用終了日は開始日以降にしてください',
    path: ['validTo'],
  });

const recipientSchema = z.object({
  name: freeText(z.string().trim().min(1, 'お子さまの名前を指定してください').max(100)),
  birthDate: calendarDateSchema.nullish(),
  /** 配慮事項・付帯情報。 */
  needs: optionalText(2000),
  allergy: optionalText(1000),
});

export const integrationCustomerSchema = z.object({
  /** 連携先の顧客ID(キーの取込元の中で一意。例: RESERVA の顧客ID)。 */
  externalId: z
    .string()
    .trim()
    .min(1, '顧客IDを指定してください')
    .max(100)
    .regex(/^[^\s]+$/, '顧客IDに空白は使えません'),
  familyName: freeText(z.string().trim().min(1, '姓を指定してください').max(100)),
  givenName: freeText(z.string().trim().max(100)).default(''),
  /** 表示名(省略時は「姓 名」)。 */
  displayName: optionalText(200),
  familyNameKana: optionalText(100),
  givenNameKana: optionalText(100),
  email: z.string().trim().email('メールアドレスの形式が正しくありません').max(254).nullish(),
  phone: optionalText(50),
  memo: optionalText(4000),
  benefitMemberId: optionalText(100),
  evacuationSite: optionalText(300),
  home: addressSchema.nullish(),
  secondary: secondaryAddressSchema.nullish(),
  emergencyContact: z.object({ relation: optionalText(100), phone: optionalText(50) }).nullish(),
  recipients: z.array(recipientSchema).max(20, 'お子さまは20人までです').default([]),
  /** 取込元の分類値(会員種別等。個人を特定しない値だけ)。キーは英小文字・数字・「_」。 */
  attributes: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, '属性のキーは英小文字・数字・「_」にしてください'),
      freeText(z.string().max(200)),
    )
    .refine((a) => Object.keys(a).length <= 30, '属性は30項目までです')
    .default({}),
  /** 連携先での登録日時・最終更新日時(ISO 8601、時差つき)。 */
  externalRegisteredAt: z.string().datetime({ offset: true }).nullish(),
  externalUpdatedAt: z.string().datetime({ offset: true }).nullish(),
});
export type IntegrationCustomer = z.output<typeof integrationCustomerSchema>;

export const integrationCustomersRequestSchema = z
  .object({
    /** upsert(作成・更新)だけ。削除・アーカイブは API では行わない。 */
    mode: z.literal('upsert').default('upsert'),
    customers: z
      .array(integrationCustomerSchema)
      .min(1, '顧客を1件以上指定してください')
      .max(
        INTEGRATION_CUSTOMERS_MAX_PER_REQUEST,
        `1回に送れる顧客は${INTEGRATION_CUSTOMERS_MAX_PER_REQUEST}件までです`,
      ),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.customers.forEach((customer, index) => {
      if (seen.has(customer.externalId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `同じ顧客IDが2回あります: ${customer.externalId}`,
          path: ['customers', index, 'externalId'],
        });
      }
      seen.add(customer.externalId);
    });
  });
export type IntegrationCustomersRequest = z.input<typeof integrationCustomersRequestSchema>;

export const INTEGRATION_CUSTOMER_OUTCOMES = ['created', 'updated', 'unchanged', 'skipped'] as const;

export const integrationCustomersResponseSchema = z.object({
  /** この受け取りの記録(import_runs.id)。 */
  importRunId: z.string().uuid(),
  counts: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    skipped: z.number().int(),
  }),
  /** 送られた順の1件ごとの結果。issues は直して取り込んだ・取り込まなかった理由のコード。 */
  results: z.array(
    z.object({
      externalId: z.string(),
      outcome: z.enum(INTEGRATION_CUSTOMER_OUTCOMES),
      issues: z.array(z.string()),
    }),
  ),
  /** 顧客データの版数(GET /api/data-version と同じ値)。 */
  dataVersion: z.string(),
});
export type IntegrationCustomersResponse = z.infer<typeof integrationCustomersResponseSchema>;
