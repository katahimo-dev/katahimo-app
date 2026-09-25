/**
 * Google Chat の Incoming Webhook URL か(`https://chat.googleapis.com/v1/spaces/<space>/messages?...`)。
 * 管理者が設定画面から保存するURLはサーバーが送信先にするため、これ以外(社内ネットワークのアドレス・
 * メタデータサーバー等)を保存・送信しないようにする(SSRF対策)。
 */
export function isGoogleChatWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'chat.googleapis.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    /^\/v1\/spaces\/[A-Za-z0-9_-]+\/messages$/.test(url.pathname)
  );
}
