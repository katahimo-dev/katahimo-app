import type { NotificationChannel, NotifierPort } from '@katahimo/core/ports';

/**
 * チャンネルごとのWebhook URLを解決する。テナントが管理者設定画面で独自のURLを保存していれば
 * それを、無ければ.env設定(呼び出し側の実装がフォールバックを持つ)を返す想定。
 */
export interface WebhookUrlResolver {
  resolve(tenantId: string, channel: NotificationChannel): Promise<string | undefined>;
}

/**
 * Google Chat Incoming Webhookへの通知。GAS版GoogleChat.js sendToGoogleChatWebhook_に対応。
 * Webhook URL未設定の場合は通知をスキップする(GAS版と同じフォールバック)。
 * URLの解決先はresolver(WebhookUrlResolver)に委譲する(テナントごとのWebhook URL管理画面が
 * 追加されたため、コンストラクタに静的なURLを固定で持たせず、呼び出しのたびに解決する)。
 */
export class WebhookNotifierPort implements NotifierPort {
  constructor(
    private readonly resolver: WebhookUrlResolver,
    private readonly testMode = false,
  ) {}

  async notify(tenantId: string, channel: NotificationChannel, text: string): Promise<void> {
    const url = await this.resolver.resolve(tenantId, channel);
    if (!url) {
      console.warn(`[GoogleChat] Webhook URL not configured for channel=${channel}; skipping notification`);
      return;
    }
    if (this.testMode) {
      console.log(`[GoogleChat][TEST_MODE] notification skipped. text=${text.slice(0, 80)}`);
      return;
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const body = await response.text();
        console.error(`[GoogleChat] Notification failed: HTTP ${response.status} ${body.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`[GoogleChat] Notification error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
