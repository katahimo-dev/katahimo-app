import { describe, expect, it } from 'vitest';
import {
  applicationServerKeyOf,
  isIosDevice,
  type PushEnvironment,
  pushAvailabilityOf,
  readPushEnvironment,
} from './pushSupport';

const desktop: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  permission: 'default',
  isIos: false,
  isStandalone: false,
};

describe('通知を受け取れるか', () => {
  it('対応しているブラウザで、許可を聞く前・許可済みなら受け取れる', () => {
    expect(pushAvailabilityOf(desktop)).toBe('available');
    expect(pushAvailabilityOf({ ...desktop, permission: 'granted' })).toBe('available');
  });

  it('拒否されていれば設定で許可し直す案内', () => {
    expect(pushAvailabilityOf({ ...desktop, permission: 'denied' })).toBe('denied');
  });

  it('Service Worker・PushManager・Notification のどれかが無ければ対応していない', () => {
    expect(pushAvailabilityOf({ ...desktop, hasServiceWorker: false })).toBe('unsupported');
    expect(pushAvailabilityOf({ ...desktop, hasPushManager: false })).toBe('unsupported');
    expect(pushAvailabilityOf({ ...desktop, permission: null })).toBe('unsupported');
  });

  it('iPhone・iPad の Safari(ホーム画面に追加していない)は「ホーム画面に追加」の案内', () => {
    const safari = { ...desktop, isIos: true, hasPushManager: false, permission: null };
    expect(pushAvailabilityOf(safari)).toBe('ios_needs_install');
    // ホーム画面のアプリ(iOS 16.4 以降)なら受け取れる
    expect(pushAvailabilityOf({ ...desktop, isIos: true, isStandalone: true })).toBe('available');
    // ホーム画面のアプリでも iOS 16.4 より前は対応していない
    expect(pushAvailabilityOf({ ...safari, isStandalone: true })).toBe('unsupported');
  });

  it('iPhone・iPad の見分け(iPadOS は Mac と名乗る)', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5)).toBe(false);
  });

  it('jsdom(PushManager・Notification が無い)は対応していない', () => {
    expect(pushAvailabilityOf(readPushEnvironment())).toBe('unsupported');
  });
});

describe('applicationServerKeyOf', () => {
  it('base64url(パディングなし)をバイト列にする', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256);
    const base64Url = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect([...applicationServerKeyOf(base64Url)]).toEqual([...bytes]);
  });
});
