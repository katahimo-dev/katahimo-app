import { describe, expect, it } from 'vitest';
import {
  DEVICE_TRUST_TTL_MS,
  deviceCredentialVersion,
  deviceRateLimitKey,
  issueDeviceToken,
  parseDeviceToken,
  verifyDeviceToken,
} from './deviceTrust';

const TENANT = '01900000-0000-7000-8000-000000000001';
const STAFF = '01900000-0000-7000-8000-000000000002';
const NOW = new Date('2026-10-01T00:00:00Z');
const version = deviceCredentialVersion({ passwordHash: '$argon2id$abc', legacyPasswordHash: null }, null);
const subject = { tenantId: TENANT, staffId: STAFF, credentialVersion: version };

function issued(secret = 'secret') {
  const token = issueDeviceToken(secret, subject, NOW);
  const parsed = parseDeviceToken(token.value);
  if (!parsed) throw new Error('読めません');
  return { token, parsed };
}

describe('「この端末」の印', () => {
  it('発行した印は同じ鍵・同じ持ち主・同じ資格情報の版で確かめられる', () => {
    const { token, parsed } = issued();
    expect(token.value).toMatch(/^v1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.\d+\.[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
    expect(verifyDeviceToken('secret', parsed, subject, NOW)).toBe(true);
    expect(token.expiresAt.getTime()).toBe(NOW.getTime() + DEVICE_TRUST_TTL_MS);
  });

  it('鍵・持ち主・資格情報の版が違えば通らない', () => {
    const { parsed } = issued();
    expect(verifyDeviceToken('other', parsed, subject, NOW)).toBe(false);
    expect(verifyDeviceToken('secret', parsed, { ...subject, staffId: TENANT }, NOW)).toBe(false);
    const changed = deviceCredentialVersion(
      { passwordHash: '$argon2id$xyz', legacyPasswordHash: null },
      null,
    );
    expect(verifyDeviceToken('secret', parsed, { ...subject, credentialVersion: changed }, NOW)).toBe(false);
    const retired = deviceCredentialVersion(
      { passwordHash: '$argon2id$abc', legacyPasswordHash: null },
      '2027-01-01',
    );
    expect(verifyDeviceToken('secret', parsed, { ...subject, credentialVersion: retired }, NOW)).toBe(false);
  });

  it('発行時刻・乱数を書き換えた印、期限切れ、未来の時刻の印は通らない', () => {
    const { parsed } = issued();
    expect(
      verifyDeviceToken('secret', { ...parsed, issuedAtSec: parsed.issuedAtSec + 1 }, subject, NOW),
    ).toBe(false);
    expect(verifyDeviceToken('secret', { ...parsed, nonce: '0'.repeat(32) }, subject, NOW)).toBe(false);
    const later = new Date(NOW.getTime() + DEVICE_TRUST_TTL_MS);
    expect(verifyDeviceToken('secret', parsed, subject, later)).toBe(false);
    const future = issueDeviceToken('secret', subject, new Date(NOW.getTime() + 60 * 60 * 1000));
    const futureParsed = parseDeviceToken(future.value);
    if (!futureParsed) throw new Error('読めません');
    expect(verifyDeviceToken('secret', futureParsed, subject, NOW)).toBe(false);
  });

  it('形の不正な値は読まない', () => {
    for (const value of [
      undefined,
      '',
      'v1',
      'v2.a.b.c.d.e',
      `v1.${TENANT}.${STAFF}.x.${'0'.repeat(32)}.${'A'.repeat(43)}`,
    ]) {
      expect(parseDeviceToken(value)).toBeNull();
    }
  });

  it('端末単位の回数のキーは端末ごとに違う(同じアカウントでも)', () => {
    expect(deviceRateLimitKey(issued().parsed)).not.toBe(deviceRateLimitKey(issued().parsed));
  });
});
