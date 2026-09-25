import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuidv7';

describe('uuidv7', () => {
  it('版7・変種RFC 9562の形式で、同じミリ秒でも生成順に並ぶ', () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7(1_790_000_000_000));
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('先頭48ビットが時刻', () => {
    const id = uuidv7(Date.UTC(2030, 0, 1));
    const ms = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(Date.UTC(2030, 0, 1));
  });
});
