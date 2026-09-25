/**
 * 通知のポート。現状の実装先は Google Chat の Incoming Webhook。
 * (GAS版 GoogleChat.js 相当。旧 gas-childcare-report の LINE WORKS 連携を置き換えたもの)
 */
export type NotificationChannel = 'report' | 'receipt';

export interface NotifierPort {
  notify(tenantId: string, channel: NotificationChannel, text: string): Promise<void>;
}
