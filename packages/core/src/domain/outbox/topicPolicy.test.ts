import { describe, expect, it } from 'vitest';
import { isOutboxTopicEnabled } from './topicPolicy';

describe('isOutboxTopicEnabled(outbox に積む・送るトピック)', () => {
  const slug = (value: string) => async () => value;

  it('ミラーは GAS Bridge の持ち主のテナントだけ(ミラーが無効ならどのテナントも積まない)', async () => {
    const policy = { mirrorTenantSlug: 'cutest', pushEnabled: false };
    expect(await isOutboxTopicEnabled(policy, 'mirror.care_record', slug('cutest'))).toBe(true);
    expect(await isOutboxTopicEnabled(policy, 'mirror.attendance_day', slug('other'))).toBe(false);
    const off = { mirrorTenantSlug: null, pushEnabled: false };
    expect(await isOutboxTopicEnabled(off, 'mirror.receipt', slug('cutest'))).toBe(false);
  });

  it('Web Push は VAPID がある時だけ、メールは常に(テナントを読まない)', async () => {
    const neverRead = async () => {
      throw new Error('テナントを読んではいけない');
    };
    expect(
      await isOutboxTopicEnabled({ mirrorTenantSlug: null, pushEnabled: true }, 'push.test', neverRead),
    ).toBe(true);
    expect(
      await isOutboxTopicEnabled(
        { mirrorTenantSlug: null, pushEnabled: false },
        'push.route_notice',
        neverRead,
      ),
    ).toBe(false);
    expect(
      await isOutboxTopicEnabled(
        { mirrorTenantSlug: null, pushEnabled: false },
        'mail.password_reset',
        neverRead,
      ),
    ).toBe(true);
  });
});
