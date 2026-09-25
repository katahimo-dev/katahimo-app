/**
 * ログ記録用のメールアドレスのマスク(例: 'hanako@example.com' → 'ha***@example.com')。
 * 台帳に無いアドレスでのログイン試行など、アカウントに紐付かないイベントを追跡できるよう
 * ドメインと先頭2文字だけを残す(アプリログには個人情報をそのまま入れない方針のため)。
 */
export function maskEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed ? `${trimmed.slice(0, 2)}***` : '';
  return `${trimmed.slice(0, Math.min(2, at))}***${trimmed.slice(at)}`;
}
