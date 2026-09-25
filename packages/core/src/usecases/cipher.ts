import type { AuditLogPort, CryptoPort, EncryptionPurpose } from '../ports/crypto';

/** 値があれば暗号化する(空文字・null は null)。 */
export function encryptOptional(
  crypto: CryptoPort,
  tenantId: string,
  purpose: EncryptionPurpose,
  rowId: string,
  value: string | null | undefined,
): Promise<Uint8Array | null> {
  return value ? crypto.encrypt({ tenantId, purpose, rowId }, value) : Promise.resolve(null);
}

/**
 * 1つの操作の中の復号を数える。操作の終わりに flush で監査ログを1件だけ書く(値ごとには書かない)。
 */
export class DecryptSession {
  private count = 0;

  constructor(
    private readonly crypto: CryptoPort,
    private readonly tenantId: string,
  ) {}

  async decrypt(purpose: EncryptionPurpose, rowId: string, value: Uint8Array): Promise<string> {
    this.count++;
    return this.crypto.decrypt({ tenantId: this.tenantId, purpose, rowId }, value);
  }

  async optional(
    purpose: EncryptionPurpose,
    rowId: string,
    value: Uint8Array | null,
  ): Promise<string | null> {
    return value ? this.decrypt(purpose, rowId, value) : null;
  }

  flush(audit: AuditLogPort | undefined, operation: string, actorStaffId?: string | null): void {
    audit?.recordDecrypt({
      tenantId: this.tenantId,
      operation,
      count: this.count,
      actorStaffId: actorStaffId ?? null,
    });
    this.count = 0;
  }
}
