import type { AppLogPort } from '../ports/appLog';
import type { NotificationChannel, NotifierPort } from '../ports/notifier';

export interface NotifyDeps {
  notifier: NotifierPort;
  appLog: AppLogPort;
}

/**
 * Google Chatへ通知し、未設定・失敗をアプリログに残す。通知の失敗で本来の処理(日報保存等)は
 * 失敗させない(GAS版sendToGoogleChatWebhook_と同じ方針)。本文は個人情報を含むためログには入れない。
 */
export async function notifyWithLog(
  deps: NotifyDeps,
  tenantId: string,
  channel: NotificationChannel,
  text: string,
  actorStaffId: string | null,
): Promise<void> {
  const result = await deps.notifier.notify(tenantId, channel, text);
  if (result.status === 'not_configured') {
    await deps.appLog.write({
      tenantId,
      level: 'WARN',
      action: 'notification.gchat.not_configured',
      actorStaffId,
      details: { channel },
    });
  } else if (result.status === 'failed') {
    await deps.appLog.write({
      tenantId,
      level: 'ERROR',
      action: 'notification.gchat.failed',
      actorStaffId,
      details: { channel, httpStatus: result.httpStatus ?? null, error: result.error },
    });
  }
}
