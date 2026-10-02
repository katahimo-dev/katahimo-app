import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { StaffCredentials } from '../../ports/staff';

/**
 * 「この端末」の印(ログインに成功した端末に置く長期の Cookie)。アカウント単位のログインのロック(login_failure_account)は
 * 第三者がわざと誤ったパスワードを送り続けると本人まで締め出せてしまうため、前に正しくログインできた端末からの要求は
 * アカウント単位のロックの代わりに「アカウント × 端末」単位(login_failure_device)で数える(OWASP の device cookie と同じ考え方)。
 *
 * - 値は `v1.<テナントID>.<スタッフID>.<発行時刻(秒)>.<端末の乱数>.<HMAC>`。HMAC の鍵は SESSION_SECRET から HKDF で導出した
 *   専用の鍵(`katahimo/device-trust/v1`)で、サーバーの外では作れない・書き換えられない。個人情報(メール・名前)は入れない。
 * - HMAC にはスタッフの資格情報の版(パスワードのハッシュと退職日から作る。deviceCredentialVersion)を混ぜるため、パスワードの
 *   変更・再設定・GAS版のハッシュからの移し替え・退職日の設定で、それまでに発行した印は全て使えなくなる(DB に印を保存しない)。
 * - 印はセッションではない: ログインを省けず、送信元IP単位の制限・パスワードの照合・退職/停止の判定は通常どおり行う。
 *   ログアウトでは消さない(端末を表すもので、セッションを表すものではない)。
 * - 1つのブラウザに置くのは最後にログインしたアカウントの1つだけ。
 */
export const DEVICE_TRUST_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const VERSION = 'v1';
const SEPARATOR = '.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** 端末の時計ではなくサーバーの時刻で作るが、インスタンス間の時計のずれだけは許す。 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** 印の持ち主(HMAC で結び付ける値)。 */
export interface DeviceTrustSubject {
  tenantId: string;
  staffId: string;
  /** 資格情報の版(deviceCredentialVersion)。 */
  credentialVersion: string;
}

/** 形を確かめただけの印(持ち主・HMAC はまだ確かめていない)。 */
export interface ParsedDeviceToken {
  tenantId: string;
  staffId: string;
  issuedAtSec: number;
  nonce: string;
  mac: string;
}

/**
 * スタッフの資格情報の版。パスワードのハッシュ(argon2id はソルトを含むため、同じパスワードに変えても変わる)と退職日から作る。
 * ハッシュそのものは印に入れず、HMAC の入力にだけ使う。
 */
export function deviceCredentialVersion(
  credentials: StaffCredentials | null,
  retiredOn: string | null,
): string {
  const hash = credentials?.passwordHash ?? credentials?.legacyPasswordHash ?? '';
  return createHash('sha256')
    .update(`${hash}\n${retiredOn ?? ''}`, 'utf8')
    .digest('base64url');
}

function macOf(secret: string, token: Omit<ParsedDeviceToken, 'mac'>, credentialVersion: string): string {
  return createHmac('sha256', secret)
    .update(
      [
        VERSION,
        token.tenantId,
        token.staffId,
        String(token.issuedAtSec),
        token.nonce,
        credentialVersion,
      ].join('\n'),
      'utf8',
    )
    .digest('base64url');
}

/** 印を発行する(ログインの成功・パスワード変更の成功の後)。 */
export function issueDeviceToken(
  secret: string,
  subject: DeviceTrustSubject,
  now: Date,
): { value: string; expiresAt: Date } {
  const token = {
    tenantId: subject.tenantId,
    staffId: subject.staffId,
    issuedAtSec: Math.floor(now.getTime() / 1000),
    nonce: randomBytes(16).toString('hex'),
  };
  const mac = macOf(secret, token, subject.credentialVersion);
  return {
    value: [VERSION, token.tenantId, token.staffId, token.issuedAtSec, token.nonce, mac].join(SEPARATOR),
    expiresAt: new Date(token.issuedAtSec * 1000 + DEVICE_TRUST_TTL_MS),
  };
}

/** Cookie の値の形だけを確かめる(形の不正は null)。 */
export function parseDeviceToken(value: string | undefined): ParsedDeviceToken | null {
  if (!value || value.length > 200) return null;
  const parts = value.split(SEPARATOR);
  if (parts.length !== 6 || parts[0] !== VERSION) return null;
  const [, tenantId = '', staffId = '', issuedAt = '', nonce = '', mac = ''] = parts;
  if (!UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(staffId)) return null;
  if (!/^\d{1,12}$/.test(issuedAt) || !NONCE_PATTERN.test(nonce) || !MAC_PATTERN.test(mac)) return null;
  return { tenantId, staffId, issuedAtSec: Number(issuedAt), nonce, mac };
}

/**
 * 印がこのアカウントのもので、改ざんされておらず、期限内で、資格情報の版が今と同じかを確かめる。
 * 別のアカウント・別のテナントの印、パスワードの変更・退職日の設定より前の印は false(ふつうのログインとして扱う)。
 */
export function verifyDeviceToken(
  secret: string,
  token: ParsedDeviceToken,
  subject: DeviceTrustSubject,
  now: Date,
): boolean {
  if (token.tenantId !== subject.tenantId || token.staffId !== subject.staffId) return false;
  const issuedAtMs = token.issuedAtSec * 1000;
  if (issuedAtMs > now.getTime() + CLOCK_SKEW_MS) return false;
  if (issuedAtMs + DEVICE_TRUST_TTL_MS <= now.getTime()) return false;
  const expected = Buffer.from(macOf(secret, token, subject.credentialVersion), 'utf8');
  const actual = Buffer.from(token.mac, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 「アカウント × 端末」単位の回数のキー(login_failure_device)。 */
export function deviceRateLimitKey(token: ParsedDeviceToken): string {
  return `${token.tenantId}:${token.staffId}:${token.nonce}`;
}
