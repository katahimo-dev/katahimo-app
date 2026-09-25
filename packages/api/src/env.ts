import { parseTenantFolderMap, SCHEDULE_PROVIDERS } from '@katahimo/integrations';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/**
 * 'true'/'1' だけを真とする機能フラグ。z.coerce.boolean() は文字列 'false' も真にしてしまう
 * (空でない文字列は Boolean() で true)ため使わない。
 */
const booleanFlag = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

/**
 * 環境変数の検証。起動時に一度だけ実行し、足りない設定は起動前に落とす。
 * GAS版は Script Properties の未設定に実行時まで気づけなかった(AUTH_SALT等)ため、
 * 新実装では起動時に明示的に検証する。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL が必要です'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET は16文字以上にしてください'),

  // BlindIndexPortの開発用実装(LocalBlindIndexPort)が使うマスターキー。32バイト(64桁hex)。
  // CryptoPort(実値の暗号化)とは意図的に鍵を分けている(一方の漏洩だけでは他方に影響しない
  // 権限分離のため、packages/core/src/ports/crypto.ts参照)。
  LOCAL_DEV_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'LOCAL_DEV_MASTER_KEY は32バイト(64桁の16進数)にしてください'),

  // CryptoPortが使うテナントDEKをラップするKEK(KeyManagementPortの開発用実装LocalKmsPortが
  // 使う)。32バイト(64桁hex)。本番はCloud KMSに置き換える(Phase 5)。LOCAL_DEV_MASTER_KEYとは
  // 別の値にすること(こちらが漏れてもblind indexの鍵には影響しない、逆も同様)。
  LOCAL_DEV_KEK: z.string().regex(/^[0-9a-f]{64}$/i, 'LOCAL_DEV_KEK は32バイト(64桁の16進数)にしてください'),

  // 移行期のみ必要: GAS版 Script Properties の AUTH_SALT と同じ値。
  // 未設定でも起動はできるが、既存パスワードでのログインは失敗する。
  LEGACY_AUTH_SALT: z.string().optional(),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),

  // ── 予定・ルート計算(doc/api/schedule-route.md) ──
  // google: Google Calendar API + Google Maps Platform を直接呼ぶ / gas_bridge: GAS版Web Appに委ねる /
  // noop: 常に予定なし。未指定なら設定されている資格情報から選ぶ(selectScheduleProvider参照)。
  SCHEDULE_PROVIDER: z.preprocess(emptyToUndefined, z.enum(SCHEDULE_PROVIDERS).optional()),
  // Geocoding API と Routes API を有効にしたAPIキー(SCHEDULE_PROVIDER=google で必須)。
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // サービスアカウントキー(JSON)のパス。Cloud Run(Workload Identity)では不要。
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  // staff.calendar_id 以外に読むカレンダー。カンマ区切りで `ID` または `ID=持ち主のスタッフ名`。
  GOOGLE_CALENDAR_IDS: z.string().optional(),
  // ドメイン全体の委任で成り代わるWorkspaceユーザー(未指定ならサービスアカウント自身として読む)。
  GOOGLE_CALENDAR_IMPERSONATE: z.string().optional(),

  // 稼働中のgas-childcare-visit-appのWeb Appデプロイ(Bridge.js)。GAS_BRIDGE_URLはその/exec
  // エンドポイント、GAS_BRIDGE_SECRETはGAS側Bridge.jsのBRIDGE_API_SECRET(Script Properties)と
  // 同じ値。SCHEDULE_PROVIDER=gas_bridge の予定取得と、outboxミラー書き込みに使う。
  GAS_BRIDGE_URL: z.string().optional(),
  GAS_BRIDGE_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  // 日報/事故報告生成・領収書OCRに使うモデル名(未設定時はGAS版と同じデフォルトを使う)。
  GEMINI_MODEL_REPORT: z.string().optional(),
  GEMINI_MODEL_OCR: z.string().optional(),

  // Google Chat Incoming Webhook。GAS版GoogleChat.jsのScript Propertiesと同じ役割。
  // 未設定の場合は通知を送らずスキップする(GAS版と同じフォールバック)。
  GCHAT_REPORT_WEBHOOK_URL: z.string().optional(),
  GCHAT_RECEIPT_WEBHOOK_URL: z.string().optional(),

  // パスワード再設定コードのメール送信(GAS版MailApp.sendEmailの置き換え)。SMTP_HOSTが未設定の場合、
  // 開発環境では送信せず内容を標準出力に出す(ConsoleMailerPort)。本番では設定必須。
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('保育日報 <noreply@localhost>'),

  // 領収書画像の保存先(ローカル開発用ファイルシステムパス)。本番はGCS(Phase 5)に置き換える。
  LOCAL_RECEIPT_STORAGE_DIR: z.string().default('./data/receipts'),

  // スプレッドシート脱却時はここを false にするだけでミラーが止まる
  MIRROR_TO_GOOGLE_SHEETS: booleanFlag,
  MIRROR_TO_GOOGLE_CALENDAR: booleanFlag,

  // 顧客CSV(RESERVA「Kokyaku_YYYYMMDDHHmm_N.csv」)の自動取込元(GAS版 CUSTOMER_CSV_FOLDER_ID)。
  // CUSTOMER_CSV_DRIVE_FOLDERS: {"テナントslug": "DriveフォルダID"} のJSON(サービスアカウントに閲覧権限を共有する)。
  // CUSTOMER_CSV_LOCAL_DIR: ローカル開発用。<dir>/<テナントslug>/ に置いたCSVを読む(Driveの設定が無い場合のみ)。
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
});

export type Env = z.infer<typeof envSchema>;

/** 項目単体では表せない組み合わせの検証。 */
function checkCombinations(env: Env): string[] {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
    problems.push('  - SMTP_HOST: 本番ではパスワード再設定メールの送信にSMTP設定が必要です');
  }
  return problems;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`環境変数の設定に問題があります:\n${detail}`);
  }
  const problems = checkCombinations(parsed.data);
  if (problems.length > 0) throw new Error(`環境変数の設定に問題があります:\n${problems.join('\n')}`);
  return parsed.data;
}
