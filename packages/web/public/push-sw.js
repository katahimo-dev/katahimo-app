// 通知(Web Push)の Service Worker の処理。vite-plugin-pwa が作る Service Worker(sw.js)が importScripts で読む
// (vite.config.ts の workbox.importScripts)。事前キャッシュ・新しい版のお知らせは sw.js(Workbox)のまま。
// 通知の中身はサーバーが暗号化して送る JSON(@katahimo/shared の pushNoticeSchema: title / body / url / tag)。
// 通知を押したら、開いているアプリの画面を前に出して開く URL を知らせる(画面が予定タブで翌日の予定を開く)。
// 画面が開いていなければ URL を新しく開く。

/** 画面(src/features/schedule/scheduleLink.ts)に知らせるメッセージの種類。 */
const NOTIFICATION_CLICK_MESSAGE = 'katahimo:notification-click';
const FALLBACK_NOTICE = { title: '保育日報', body: '', url: '/', tag: 'katahimo' };

/** 届いた中身を通知の形にする(読めなければ既定の通知。userVisibleOnly のため必ず何か出す)。 */
function noticeOf(data) {
  try {
    const notice = data ? data.json() : null;
    if (!notice || typeof notice.title !== 'string') return FALLBACK_NOTICE;
    return {
      title: notice.title,
      body: typeof notice.body === 'string' ? notice.body : '',
      url: typeof notice.url === 'string' && notice.url.startsWith('/') ? notice.url : '/',
      tag: typeof notice.tag === 'string' ? notice.tag : FALLBACK_NOTICE.tag,
    };
  } catch {
    return FALLBACK_NOTICE;
  }
}

self.addEventListener('push', (event) => {
  const notice = noticeOf(event.data);
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      lang: 'ja',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      data: { url: notice.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  const path = `${target.pathname}${target.search}`;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        // 前に出せなくても(端末の制限)画面には知らせる
        await client.focus().catch(() => undefined);
        client.postMessage({ type: NOTIFICATION_CLICK_MESSAGE, url: path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
