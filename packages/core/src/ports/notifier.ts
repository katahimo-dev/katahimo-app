/**
 * 通知のポート。現状の実装先は Google Chat の Incoming Webhook。
 * (GAS版 GoogleChat.js 相当。旧 gas-childcare-report の LINE WORKS 連携を置き換えたもの)
 */
export type NotificationChannel = 'report' | 'receipt';

/**
 * 通知の結果。通知の失敗で本来の処理(日報保存等)を失敗させないため例外は投げず、結果を返す。
 * 呼び出し側(usecases/notify.ts)が not_configured/failed をアプリログに記録する
 * (GAS版sendToGoogleChatWebhook_のGoogleChatWebhookNotConfigured/Failed/Errorに相当)。
 */
export type NotifyResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'test_mode' }
  | { status: 'not_configured' }
  | { status: 'failed'; httpStatus?: number; error: string };

export interface NotifierPort {
  notify(tenantId: string, channel: NotificationChannel, text: string): Promise<NotifyResult>;
}
