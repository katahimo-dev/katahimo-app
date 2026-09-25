import { isGoogleChatWebhookUrl } from '@katahimo/core/domain';
import type { NotificationChannel, NotifierPort, NotifyResult } from '@katahimo/core/ports';

/**
 * チャンネルごとのWebhook URLを解決する。テナントが管理者設定画面で独自のURLを保存していれば
 * それを、無ければ.env設定(呼び出し側の実装がフォールバックを持つ)を返す想定。
 */
export interface WebhookUrlResolver {
  resolve(tenantId: string, channel: NotificationChannel): Promise<string | undefined>;
}

/** 1回の送信の待ち時間の上限。Google Chat が応答しなくても日報保存等の応答を長く止めないため。 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Google Chat Incoming Webhookへの通知。GAS版GoogleChat.js sendToGoogleChatWebhook_に対応。
 * 例外は投げず結果を返す(未設定・失敗のログ記録は呼び出し側のusecases/notify.tsが行う)。
 * testMode(GAS版Script Properties TEST_MODEに相当)では送信をスキップする。
 *
 * 送信先は Google Chat の Webhook URL(https://chat.googleapis.com/v1/spaces/...)に限り、リダイレクトは
 * 追わない(保存時の検証をすり抜けた値や.envの設定ミスでも、任意のURLへ送らないようにするため)。
 * 失敗時の結果には応答本文を含めない(HTTPステータスだけ。アプリログに外部の応答を残さない)。
 */
export class WebhookNotifierPort implements NotifierPort {
  constructor(
    private readonly resolver: WebhookUrlResolver,
    private readonly testMode = false,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async notify(tenantId: string, channel: NotificationChannel, text: string): Promise<NotifyResult> {
    const url = await this.resolver.resolve(tenantId, channel);
    if (!url) return { status: 'not_configured' };
    if (!isGoogleChatWebhookUrl(url)) return { status: 'failed', error: 'invalid_webhook_url' };
    if (this.testMode) return { status: 'skipped', reason: 'test_mode' };
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // 応答本文は読まずに捨てる(接続を解放するため)
      await response.body?.cancel();
      if (!response.ok) return { status: 'failed', httpStatus: response.status, error: 'http_error' };
      return { status: 'sent' };
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { status: 'failed', error: timedOut ? 'timeout' : 'network_error' };
    }
  }
}
