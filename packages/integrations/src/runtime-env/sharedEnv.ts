import type { OutboxTopic } from '@katahimo/core/domain';
import { MIRROR_TOPICS, PUSH_TOPICS } from '@katahimo/core/domain';
import { z } from 'zod';
import { parseTenantFolderMap } from '../customer-csv/createCustomerCsvSource';
import { SCHEDULE_PROVIDERS, scheduleEnvProblems } from '../schedule-provider';
import { STORAGE_PROVIDERS, storageEnvProblems } from '../storage-provider';
import { vapidPublicKeySchema } from '../web-push/webPushConfig';

/** 空文字の環境変数は未設定として扱う。 */
export const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/**
 * 'true'/'1' だけを真とする機能フラグ。z.coerce.boolean() は文字列 'false' も真にしてしまう
 * (空でない文字列は Boolean() で true)ため使わない。
 */
export const booleanFlag = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

/** 省略可能な正の整数(空文字は未設定)。 */
export const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

/**
 * API とワーカーで同じ値にしなければならない環境変数(保存先・予定の取得元・ミラー・取込元)。
 * 片方だけ変えると、もう片方が画像を見つけられない・ミラーの扱いが食い違う。
 * 各アプリの env はこれに自分だけの変数を足す(packages/api/src/env.ts・packages/worker/src/env.ts)。
 */
export const sharedEnvShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // 領収書画像の保存先。local: LOCAL_RECEIPT_STORAGE_DIR(開発用) / gcs: GCS_BUCKET(本番は必須)。
  // ワーカーは API が保存した画像を読み直して GAS版へミラーする。
  STORAGE_PROVIDER: z.preprocess(emptyToUndefined, z.enum(STORAGE_PROVIDERS).default('local')),
  LOCAL_RECEIPT_STORAGE_DIR: z.string().default('./data/receipts'),
  GCS_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),

  // ── 予定・ルート計算(doc/05_バッチ・外部連携.md 4章) ──
  // google: Google Calendar API + Google Maps Platform / gas_bridge: GAS版 Web App / noop: 常に予定なし。
  // 未指定なら設定されている資格情報から選ぶ(selectScheduleProvider)。
  SCHEDULE_PROVIDER: z.preprocess(emptyToUndefined, z.enum(SCHEDULE_PROVIDERS).optional()),
  GOOGLE_MAPS_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GOOGLE_APPLICATION_CREDENTIALS: z.preprocess(emptyToUndefined, z.string().optional()),
  // staff_calendars 以外に読むカレンダー。カンマ区切りで `ID` または `ID=持ち主のスタッフ名`。
  GOOGLE_CALENDAR_IDS: z.preprocess(emptyToUndefined, z.string().optional()),
  // ドメイン全体の委任で成り代わる Workspace ユーザー(未指定ならサービスアカウント自身として読む)。
  GOOGLE_CALENDAR_IMPERSONATE: z.preprocess(emptyToUndefined, z.string().optional()),

  // 稼働中の gas-childcare-visit-app の Web App(Bridge.js)。予定の取得(gas_bridge)とミラーの送信に使う。
  GAS_BRIDGE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  GAS_BRIDGE_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),

  // スプレッドシートへのミラー。false ならミラーのトピックを outbox に積まず(API)、残っていても送らない(ワーカー)。
  MIRROR_TO_GOOGLE_SHEETS: booleanFlag,

  // 顧客CSV(RESERVA「Kokyaku_YYYYMMDDHHmm_N.csv」)の取込元。
  // CUSTOMER_CSV_DRIVE_FOLDERS: {"テナントslug": "DriveフォルダID"} の JSON。
  // CUSTOMER_CSV_LOCAL_DIR: ローカル開発用。<dir>/<テナントslug>/ に置いた CSV を読む(Drive の設定が無い場合のみ)。
  CUSTOMER_CSV_DRIVE_FOLDERS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseTenantFolderMap(value);
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: e instanceof Error ? e.message : String(e) });
        return z.NEVER;
      }
    }),
  CUSTOMER_CSV_LOCAL_DIR: z.preprocess(emptyToUndefined, z.string().optional()),

  // Web Push(翌日の予定のお知らせ)の VAPID の公開鍵。API は画面に渡し、ワーカーは秘密鍵と組にして署名する。
  // 未設定なら Web Push を使わない(API は購読を受け付けず、push.* を outbox に積まない)。
  VAPID_PUBLIC_KEY: vapidPublicKeySchema,
};

const sharedEnvSchema = z.object(sharedEnvShape);
export type SharedEnv = z.infer<typeof sharedEnvSchema>;

/** 項目単体では表せない組み合わせの検証(共通部分)。 */
export function sharedEnvProblems(env: SharedEnv): string[] {
  const isProduction = env.NODE_ENV === 'production';
  return [...storageEnvProblems(env, isProduction), ...scheduleEnvProblems(env, isProduction)];
}

/** 環境変数を検証する。問題があれば全てをまとめた例外にする(起動前に落とす)。 */
export function parseEnvOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  source: NodeJS.ProcessEnv,
  combinations: (env: z.output<S>) => string[],
): z.output<S> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`環境変数の設定に問題があります:\n${detail}`);
  }
  const problems = combinations(parsed.data);
  if (problems.length > 0) throw new Error(`環境変数の設定に問題があります:\n${problems.join('\n')}`);
  return parsed.data;
}

/**
 * outbox に積まないトピック(UoW の skipOutboxTopics): MIRROR_TO_GOOGLE_SHEETS が無効ならスプレッドシートへの
 * ミラー、VAPID_PUBLIC_KEY が無ければ Web Push。
 */
export function skippedOutboxTopics(
  env: Pick<SharedEnv, 'MIRROR_TO_GOOGLE_SHEETS' | 'VAPID_PUBLIC_KEY'>,
): OutboxTopic[] {
  return [
    ...(env.MIRROR_TO_GOOGLE_SHEETS ? [] : MIRROR_TOPICS),
    ...(env.VAPID_PUBLIC_KEY ? [] : PUSH_TOPICS),
  ];
}
