import { z } from 'zod';

/**
 * ワーカー(outboxミラー・夜間同期・CSV取込ポーリング)用の環境変数検証。
 * APIサーバー(packages/api/src/env.ts)と役割が異なるため、必要な変数だけを最小限持つ
 * (SESSION_SECRET・LOCAL_DEV_MASTER_KEY等、認証・ブラインドインデックス関連はワーカーには不要)。
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

  // 未設定の場合はNoopMirrorSenderPort(何もせず成功扱い)にフォールバックする。
  GAS_BRIDGE_URL: z.string().optional(),
  GAS_BRIDGE_SECRET: z.string().optional(),

  // ポーリング間隔(ミリ秒)。
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // 1テナント・1ポーリングあたりの最大処理件数。
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(10),
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
