import { z } from 'zod';

/**
 * Web Push の VAPID(RFC 8292)の設定。公開鍵は API(画面が購読に使う)とワーカー(署名)の両方、秘密鍵と
 * 連絡先(subject)はワーカーだけが持つ。鍵は `pnpm push:vapid-keys`(web-push generate-vapid-keys)で作る。
 * 公開鍵が無ければ Web Push は使えない(API は使えないと答え、画面は通知の欄を出さない)。
 */

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function base64UrlByteLength(value: string): number | null {
  return BASE64URL.test(value) ? Buffer.from(value, 'base64url').length : null;
}

/** 空文字は未設定として扱う(runtime-env の emptyToUndefined と同じ)。 */
const unsetIfEmpty = (value: unknown) => (value === '' ? undefined : value);

/** VAPID の公開鍵(P-256 の非圧縮の点 = 65バイト、base64url)。 */
export const vapidPublicKeySchema = z.preprocess(
  unsetIfEmpty,
  z
    .string()
    .refine((v) => base64UrlByteLength(v) === 65, 'VAPID_PUBLIC_KEY は65バイトの base64url にしてください')
    .optional(),
);

/** ワーカーだけが持つ VAPID の設定(秘密鍵は Secret Manager)。 */
export const vapidSenderEnvShape = {
  // 秘密鍵(32バイト、base64url)。
  VAPID_PRIVATE_KEY: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .refine((v) => base64UrlByteLength(v) === 32, 'VAPID_PRIVATE_KEY は32バイトの base64url にしてください')
      .optional(),
  ),
  // プッシュサービスが問題のあるときに連絡する先(mailto: か https:)。
  VAPID_SUBJECT: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .regex(/^(mailto:\S+@\S+|https:\/\/\S+)$/, 'VAPID_SUBJECT は mailto: か https: で始めてください')
      .optional(),
  ),
};

export interface VapidEnv {
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}

export interface VapidDetails {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** ワーカーの VAPID の設定の組み合わせ(3つ揃っているか、どれも無いか)。 */
export function vapidEnvProblems(env: VapidEnv): string[] {
  const set = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].filter(Boolean).length;
  if (set === 0 || set === 3) return [];
  return [
    '  - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT: Web Push を使うには3つとも設定してください(使わないなら3つとも空)',
  ];
}

/** 3つ揃っていれば送信に使う設定、無ければ null(Web Push を使わない)。 */
export function vapidDetailsOf(env: VapidEnv): VapidDetails | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}
