import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, isUuid, parseCursorTimestamp } from './keysetCursor';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const ID = '0192f1d2-0000-7000-8000-000000000001';

describe('続きの位置(keyset カーソル)の検証', () => {
  it('UUID は 8-4-4-4-12 桁の16進数だけ', () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    for (const bad of [
      '-'.repeat(36),
      `${ID}0`,
      ID.replaceAll('-', ''),
      'g'.repeat(8) + ID.slice(8),
      1,
      null,
    ]) {
      expect(isUuid(bad), String(bad)).toBe(false);
    }
  });

  it('時刻は ISO 8601 と PostgreSQL の timestamptz の文字列だけ(時差つき・0001〜9999年・実在する日時)', () => {
    expect(parseCursorTimestamp('2026-09-25T01:02:03.456Z')?.toISOString()).toBe('2026-09-25T01:02:03.456Z');
    expect(parseCursorTimestamp('2026-09-25 10:02:03.456789+09')?.toISOString()).toBe(
      '2026-09-25T01:02:03.456Z',
    );
    expect(parseCursorTimestamp('2026-09-25 01:02:03+00')?.toISOString()).toBe('2026-09-25T01:02:03.000Z');
    expect(parseCursorTimestamp('2026-09-25T10:02:03+09:00')?.toISOString()).toBe('2026-09-25T01:02:03.000Z');
    expect(parseCursorTimestamp('2026-09-25 10:02:03-15:59')?.toISOString()).toBe('2026-09-26T02:01:03.000Z');
    for (const bad of [
      '2026-09-25',
      '2026-09-25T01:02:03',
      // 時差は PostgreSQL が受け付ける ±15:59 まで(JS の Date は受け付けるが DB で 500 になる)
      '2026-09-25 10:00:00+20',
      '2026-09-25T10:00:00+16:00',
      '2026-09-25T10:00:00+09:60',
      // 0000年は PostgreSQL の timestamptz が受け付けない。5桁以上・紀元前は toISOString が ±6桁で書く
      '0000-01-01T00:00:00Z',
      '0000-12-31 23:59:59+00',
      '10000-01-01T00:00:00Z',
      '+275760-09-13T00:00:00.000Z',
      '-000001-01-01T00:00:00.000Z',
      '0001-01-01 00:00:00+00 BC',
      '0100-02-29T00:00:00Z',
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-09-25T24:00:00Z',
      'Sep 25 2026',
      '1',
    ]) {
      expect(parseCursorTimestamp(bad), bad).toBeNull();
    }
  });

  it('記録の日時として保存されうる年の端(0001年・9999年・うるう日)も、サーバーが作った続きの位置として読み戻せる', () => {
    for (const iso of [
      '0001-01-01T00:00:00.000Z',
      '0099-12-31T23:59:59.999Z',
      '0004-02-29T00:00:00.000Z',
      '1900-01-01T00:00:00.000Z',
      '1999-12-31T15:00:00.000Z',
      '2101-01-01T00:00:00.000Z',
      '9999-12-31T23:59:59.999Z',
    ]) {
      const at = new Date(iso);
      // サーバーは toISOString() で書く(careRecord / receiptList / auditLogs の encode*Cursor と同じ)
      const decoded = decodeKeysetCursor(encode([at.toISOString(), ID]));
      expect(decoded?.at.toISOString(), iso).toBe(iso);
      expect(decoded?.atText).toBe(iso);
    }
    // PostgreSQL の timestamptz の文字列の端
    expect(parseCursorTimestamp('0001-01-01 09:00:00+09')?.toISOString()).toBe('0001-01-01T00:00:00.000Z');
    expect(parseCursorTimestamp('9999-12-31 23:59:59.999999+00')?.toISOString()).toBe(
      '9999-12-31T23:59:59.999Z',
    );
  });

  it('[時刻, ID] の2つだけを読む(壊れた base64・JSON・形の違う配列は null)', () => {
    expect(decodeKeysetCursor(encode(['2026-09-25T01:02:03.456Z', ID]))).toEqual({
      at: new Date('2026-09-25T01:02:03.456Z'),
      atText: '2026-09-25T01:02:03.456Z',
      id: ID,
    });
    for (const bad of [
      'xxx',
      encode({ at: '2026-09-25T01:02:03Z', id: ID }),
      encode(['2026-09-25T01:02:03Z']),
      encode(['2026-09-25T01:02:03Z', ID, 1]),
      encode([ID, '2026-09-25T01:02:03Z']),
    ]) {
      expect(decodeKeysetCursor(bad), bad).toBeNull();
    }
  });
});
