/**
 * 復号操作の監査ログポート。
 *
 * 「暗号化に本当に価値を持たせるには、鍵管理の分離だけでなく“誰が・いつ・どのテナントの
 * データを復号したか”を追跡できることが必要」という2026-08 データベース構造レビューの指摘に
 * 対応するための最小限の仕組み。
 *
 * 現時点のスコープ: CryptoPort.decrypt が呼ばれるたびに、対象テナントと発生時刻を記録する。
 * 呼び出し元(どのスタッフのどの操作か)までは記録しない — decrypt(tenantId, value) という
 * 現在のシグネチャにはその情報が渡ってきておらず、全呼び出し箇所(usecases配下40箇所以上)に
 * 呼び出し元コンテキストを配線するのは影響範囲が大きいため、今回は見送った。将来「誰が」まで
 * 必要になった場合は、CryptoPortのシグネチャに呼び出し元情報(staffId等)を追加する形で拡張する。
 *
 * 実装はCloud Run上ではstdout/stderrがそのままCloud Loggingに取り込まれるため、
 * ローカル開発・本番共通で `ConsoleAuditLogPort`(@katahimo/integrations)をそのまま使える。
 */

export interface AuditLogEntry {
  tenantId: string;
  /** 呼び出し元を辿るための最小限の手がかり(例: 'customer.name')。無くても記録自体は行う。 */
  context?: string;
}

export interface AuditLogPort {
  recordDecrypt(entry: AuditLogEntry): void;
}
