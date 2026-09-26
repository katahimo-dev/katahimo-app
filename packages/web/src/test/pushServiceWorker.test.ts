import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CLICK_MESSAGE, scheduleLinkDateOfMessage } from '../features/schedule/scheduleLink';

/**
 * public/push-sw.js(Service Worker が importScripts で読む通知の処理)を、偽の Service Worker の環境で動かす。
 */
const SCRIPT = readFileSync(resolve(import.meta.dirname, '../../public/push-sw.js'), 'utf8');
const ORIGIN = 'https://app.example';

type Listener = (event: Record<string, unknown>) => void;

function loadWorker(
  windows: { url: string; focus: () => Promise<unknown>; postMessage: (m: unknown) => void }[],
) {
  const listeners = new Map<string, Listener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
  };
  runInNewContext(SCRIPT, { self, URL });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  return { self, dispatch };
}

const pushEvent = (payload: unknown) => ({
  data: {
    json: () => {
      if (typeof payload === 'string') throw new SyntaxError('not json');
      return payload;
    },
  },
});

describe('Service Worker の通知の処理(public/push-sw.js)', () => {
  it('届いた中身の title・body・tag で通知を出し、押したときの URL を持たせる', async () => {
    const { self, dispatch } = loadWorker([]);
    await dispatch(
      'push',
      pushEvent({
        title: '明日の予定 9/27(日) 1件',
        body: '10:00〜12:00 山田 花子様',
        url: '/?schedule=2026-09-27',
        tag: 'route-notice-2026-09-27',
      }),
    );
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      '明日の予定 9/27(日) 1件',
      expect.objectContaining({
        body: '10:00〜12:00 山田 花子様',
        tag: 'route-notice-2026-09-27',
        data: { url: '/?schedule=2026-09-27' },
      }),
    );
  });

  it('読めない中身・別のオリジンの URL は既定の通知・トップにする', async () => {
    const { self, dispatch } = loadWorker([]);
    await dispatch('push', pushEvent('broken'));
    await dispatch('push', pushEvent({ title: 'x', url: 'https://evil.example/' }));
    const calls = self.registration.showNotification.mock.calls as unknown as [string, { data: unknown }][];
    expect(calls.map(([title, options]) => [title, options.data])).toEqual([
      ['保育日報', { url: '/' }],
      ['x', { url: '/' }],
    ]);
  });

  it('押したとき、開いている画面があれば前に出して URL を知らせる', async () => {
    const win = { url: `${ORIGIN}/`, focus: vi.fn(async () => undefined), postMessage: vi.fn() };
    const { self, dispatch } = loadWorker([win]);
    const close = vi.fn();
    await dispatch('notificationclick', { notification: { close, data: { url: '/?schedule=2026-09-27' } } });
    expect(close).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
    const [message] = win.postMessage.mock.calls[0] as [unknown];
    expect(message).toEqual({ type: NOTIFICATION_CLICK_MESSAGE, url: '/?schedule=2026-09-27' });
    // 画面(予定タブ)がそのまま読める形
    expect(scheduleLinkDateOfMessage(message, ORIGIN)).toBe('2026-09-27');
  });

  it('開いている画面が無ければ URL を開く', async () => {
    const { self, dispatch } = loadWorker([]);
    await dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/?schedule=2026-09-27' } },
    });
    expect(self.clients.openWindow).toHaveBeenCalledWith('/?schedule=2026-09-27');
  });
});
