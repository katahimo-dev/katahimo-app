import { hkdfSync } from 'node:crypto';

/**
 * SESSION_SECRET から用途ごとの鍵をHKDF-SHA256で導出する。1つの秘密値を複数の用途(再設定コードの
 * HMAC・レート制限のキーのハッシュ等)にそのまま使い回さず、用途ラベル(info)ごとに独立した鍵にする
 * (ある用途の鍵・出力が漏れても、他の用途の鍵を計算できない)。戻り値は64桁の16進数。
 *
 * ラベルを変えると導出される鍵が変わる(発行済みの再設定コードは照合できなくなる)ため、変えないこと。
 */
export function deriveSecret(masterSecret: string, label: DerivedSecretLabel): string {
  return Buffer.from(hkdfSync('sha256', masterSecret, Buffer.alloc(0), label, 32)).toString('hex');
}

export type DerivedSecretLabel = 'katahimo/password-reset-code/v1' | 'katahimo/rate-limit-key/v1';
