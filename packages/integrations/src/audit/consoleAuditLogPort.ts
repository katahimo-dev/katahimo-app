import type { AuditLogEntry, AuditLogPort } from '@katahimo/core/ports';

/**
 * AuditLogPortの実装。構造化JSONを1行だけstdoutへ出力する。
 *
 * Cloud Run上はstdout/stderrがそのままCloud Loggingに取り込まれるため、ローカル開発・本番の
 * 両方でこの実装だけで足りる(専用のロギングSDK・追加のGCP権限設定が不要)。
 * `severity`をCloud Loggingの構造化ログ規約に合わせているのは、Cloud Logging上で
 * 重要度フィルタがそのまま使えるようにするため。
 */
export class ConsoleAuditLogPort implements AuditLogPort {
  recordDecrypt(entry: AuditLogEntry): void {
    console.log(
      JSON.stringify({
        severity: 'INFO',
        auditAction: 'crypto.decrypt',
        tenantId: entry.tenantId,
        context: entry.context ?? null,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
