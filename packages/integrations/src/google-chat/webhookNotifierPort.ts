import type { NotificationChannel, NotifierPort, NotifyResult } from '@katahimo/core/ports';

/**
 * チャンネルごとのWebhook URLを解決する。テナントが管理者設定画面で独自のURLを保存していれば
 * それを、無ければ.env設定(呼び出し側の実装がフォールバックを持つ)を返す想定。
 */
export interface WebhookUrlResolver {
  resolve(tenantId: string, channel: NotificationChannel): Promise<string | undefined>;
}

/**
 * Google Chat Incoming Webhookへの通知。GAS版GoogleChat.js sendToGoogleChatWebhook_に対応。
 * 例外は投げず結果を返す(未設定・失敗のログ記録は呼び出し側のusecases/notify.tsが行う)。
 * testMode(GAS版Script Properties TEST_MODEに相当)では送信をスキップする。
 */
export class WebhookNotifierPort implements NotifierPort {
  constructor(
    private readonly resolver: WebhookUrlResolver,
    private readonly testMode = false,
  ) {}

  async notify(tenantId: string, channel: NotificationChannel, text: string): Promise<NotifyResult> {
    const url = await this.resolver.resolve(tenantId, channel);
    if (!url) return { status: 'not_configured' };
    if (this.testMode) return { status: 'skipped', reason: 'test_mode' };
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const body = await response.text();
        return { status: 'failed', httpStatus: response.status, error: body.slice(0, 200) };
      }
      return { status: 'sent' };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }
}
