import { describe, expect, it } from 'vitest';
import { rateLimitIpSubject } from './ipSubject';

describe('rateLimitIpSubject(送信元IP単位のレート制限の対象)', () => {
  it('IPv4 はそのまま', () => {
    expect(rateLimitIpSubject('192.0.2.1')).toBe('192.0.2.1');
    expect(rateLimitIpSubject('255.255.255.255')).toBe('255.255.255.255');
  });

  it('IPv4 射影の IPv6 は中の IPv4(IPv4 と同じ対象)', () => {
    expect(rateLimitIpSubject('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(rateLimitIpSubject('::FFFF:c000:0201')).toBe('192.0.2.1');
    expect(rateLimitIpSubject('0:0:0:0:0:ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('IPv6 は /64 の範囲にまとめる(同じ /64 の別のアドレスは同じ対象)', () => {
    expect(rateLimitIpSubject('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpSubject('2001:db8:1:2::abcd')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpSubject('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpSubject('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
  });

  it('省略形・0の並び・ゾーンID・角かっこを正規の書き方にそろえる', () => {
    expect(rateLimitIpSubject('2001:db8::1')).toBe('2001:db8::/64');
    expect(rateLimitIpSubject('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::/64');
    expect(rateLimitIpSubject('::1')).toBe('::/64');
    expect(rateLimitIpSubject('::')).toBe('::/64');
    expect(rateLimitIpSubject('fe80::1%eth0')).toBe('fe80::/64');
    expect(rateLimitIpSubject('[2001:db8:1:2::9]')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpSubject('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
    expect(rateLimitIpSubject('1:2:3:4:5:6:192.0.2.1')).toBe('1:2:3:4::/64');
    expect(rateLimitIpSubject('::192.0.2.1')).toBe('::/64');
  });

  it('読めない値はそのまま', () => {
    for (const value of [
      '',
      'unknown',
      '256.0.0.1',
      '1.2.3',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      ':::',
      ':1:2:3:4:5:6:7',
      '12345::1',
      'g::1',
      '1:2:3:4:5:6:7:8::',
      '::ffff:999.0.0.1',
    ]) {
      expect(rateLimitIpSubject(value)).toBe(value);
    }
  });
});
