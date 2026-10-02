import type { AppLogEntry } from '@katahimo/core/ports';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Container } from '../container';
import { requireAdmin, requireSession } from '../session';
import { DenialLogThrottle } from './denialLogThrottle';

describe('DenialLogThrottle', () => {
  it('送信元ごとに窓の中で上限まで書き、超えた分は次の窓の最初の1件に件数を残す', () => {
    let now = 0;
    const throttle = new DenialLogThrottle({ limit: 2, windowMs: 1000, maxKeys: 10 }, () => now);
    expect(throttle.take('192.0.2.1')).toEqual({ suppressed: 0 });
    expect(throttle.take('192.0.2.1')).toEqual({ suppressed: 0 });
    expect(throttle.take('192.0.2.1')).toBeNull();
    expect(throttle.take('192.0.2.1')).toBeNull();
    // 別の送信元は別に数える
    expect(throttle.take('192.0.2.2')).toEqual({ suppressed: 0 });
    now = 1000;
    expect(throttle.take('192.0.2.1')).toEqual({ suppressed: 2 });
    expect(throttle.take('192.0.2.1')).toEqual({ suppressed: 0 });
  });

  it('IPv6 は /64 ごと、IP の無い要求は1つの送信元として数える', () => {
    const throttle = new DenialLogThrottle({ limit: 1, windowMs: 1000, maxKeys: 10 }, () => 0);
    expect(throttle.take('2001:db8:1:2::1')).toEqual({ suppressed: 0 });
    expect(throttle.take('2001:db8:1:2::ffff')).toBeNull();
    expect(throttle.take(null)).toEqual({ suppressed: 0 });
    expect(throttle.take(undefined)).toBeNull();
  });

  it('覚える送信元の数には上限があり、最も前に使った送信元から忘れる', () => {
    const throttle = new DenialLogThrottle({ limit: 1, windowMs: 1000, maxKeys: 2 }, () => 0);
    throttle.take('192.0.2.1');
    throttle.take('192.0.2.2');
    throttle.take('192.0.2.1');
    throttle.take('192.0.2.3');
    expect(throttle.size).toBe(2);
    // 192.0.2.2 を忘れたので、また書ける。192.0.2.1 は覚えている
    expect(throttle.take('192.0.2.2')).toEqual({ suppressed: 0 });
    expect(throttle.take('192.0.2.3')).toBeNull();
  });
});

describe('ログインしていない要求の拒否の操作ログ', () => {
  function appWith(limit: number) {
    const entries: AppLogEntry[] = [];
    const container = {
      appLog: {
        async write(entry: AppLogEntry) {
          entries.push(entry);
        },
      },
      config: { isProduction: false },
      denialLogThrottle: new DenialLogThrottle({ limit, windowMs: 60_000, maxKeys: 100 }),
    } as unknown as Container;
    const app = new Hono();
    app.get('/s', requireSession(container, 'test.session'), (c) => c.text('ok'));
    app.get('/a', requireAdmin(container, 'test.admin'), (c) => c.text('ok'));
    return { app, entries };
  }

  it('応答は毎回 401 のまま、操作ログは送信元ごとに間引く(requireSession・requireAdmin で共有)', async () => {
    const { app, entries } = appWith(3);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await app.request('/s')).status);
      statuses.push((await app.request('/a')).status);
    }
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect(entries.map((e) => e.action)).toEqual([
      'test.session.access_denied',
      'test.admin.access_denied',
      'test.session.access_denied',
    ]);
    expect(entries[0]).toMatchObject({
      level: 'WARN',
      tenantId: null,
      details: { reason: 'invalid_session' },
    });
  });
});
