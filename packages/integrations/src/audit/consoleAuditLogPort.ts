import type { AuditLogPort, DecryptAuditEntry } from '@katahimo/core/ports';

/**
 * AuditLogPort の実装。復号の操作ごとに1行の構造化JSON(Cloud Logging の severity 付き)を標準出力に書く
 * (値ごとではなく操作ごとに件数をまとめる)。
 */
export class ConsoleAuditLogPort implements AuditLogPort {
  recordDecrypt(entry: DecryptAuditEntry): void {
    if (entry.count === 0) return;
    console.log(
      JSON.stringify({
        severity: 'INFO',
        auditAction: 'crypto.decrypt',
        tenantId: entry.tenantId,
        operation: entry.operation,
        count: entry.count,
        actorStaffId: entry.actorStaffId ?? null,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
