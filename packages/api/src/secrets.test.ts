import { describe, expect, it } from 'vitest';
import { deriveSecret } from './secrets';

describe('deriveSecret', () => {
  it('同じ秘密値・同じ用途なら同じ鍵、用途が違えば別の鍵(元の秘密値そのものでもない)', () => {
    const a = deriveSecret('session-secret-example', 'katahimo/password-reset-code/v1');
    expect(deriveSecret('session-secret-example', 'katahimo/password-reset-code/v1')).toBe(a);
    expect(deriveSecret('session-secret-example', 'katahimo/rate-limit-key/v1')).not.toBe(a);
    expect(deriveSecret('other-secret', 'katahimo/password-reset-code/v1')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
