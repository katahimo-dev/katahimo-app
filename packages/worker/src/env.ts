import { parseTenantFolderMap, SCHEDULE_PROVIDERS } from '@katahimo/integrations';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/** 'true'/'1' だけを真とする機能フラグ(z.coerce.boolean() は 'false' も真にしてしまうため)。 */
const booleanFlag = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

/**
 * ワーカー(outboxミラーの常駐ポーラー・夜間のカレンダー反映・顧客CSV取込)用の環境変数検証。
 * APIサーバー(packages/api/src/env.ts)と役割が異なるため、必要な変数だけを持つ。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL が必要です'),

  // CryptoPortが使うテナントDEKをラップするKEK。packages/api/src/env.tsのLOCAL_DEV_KEKと同じ値
  // (テナントごとのDEKはDB(tenant_keys)に保存されているため、API/ワーカー間で共有する)。
  LOCAL_DEV_KEK: z.string().regex(/^[0-9a-f]{64}$/i, 'LOCAL_DEV_KEK は32バイト(64桁の16進数)にしてください'),

  // 領収書画像の保存先。packages/api/src/env.tsのLOCAL_RECEIPT_STORAGE_DIRと同じ値にすること
  // (ワーカーはAPIサーバーが保存したファイルを読み直してGAS版Driveへミラーする)。
  LOCAL_RECEIPT_STORAGE_DIR: z.string().default('./data/receipts'),

  // 予定・ルート計算の実装(packages/api/src/env.ts と同じ意味。夜間のカレンダー反映に使う)。
  SCHEDULE_PROVIDER: z.preprocess(emptyToUndefined, z.enum(SCHEDULE_PROVIDERS).optional()),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_CALENDAR_IDS: z.string().optional(),
  GOOGLE_CALENDAR_IMPERSONATE: z.string().optional(),

  // GAS版 Web App(Bridge.js)。未設定ならミラー送信は何もせず成功扱いになる。
  GAS_BRIDGE_URL: z.string().optional(),
  GAS_BRIDGE_SECRET: z.string().optional(),

  // job:sync-busy-blocks が同期する期間(今日から何日先まで)。
  BUSY_BLOCK_SYNC_DAYS: z.coerce.number().int().positive().default(28),

  // ── outboxミラー ──
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // 1テナント・1ポーリングあたりの最大処理件数。
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  // 再試行: 最大試行回数・初回の待ち時間(以後倍々)・待ち時間の上限。
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  OUTBOX_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(30_000),
  OUTBOX_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(3_600_000),

  // ── 顧客CSV取込(packages/api/src/env.ts と同じ意味) ──
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
  CUSTOMER_CSV_LOCAL_DIR: z.string().optional(),

  // ローカル開発用: 常駐ワーカーの中で夜間ジョブも時刻どおりに動かす(本番は Cloud Scheduler → Cloud Run Jobs)。
  WORKER_IN_PROCESS_CRON: booleanFlag,
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`環境変数の設定に問題があります:\n${detail}`);
  }
  return parsed.data;
}
