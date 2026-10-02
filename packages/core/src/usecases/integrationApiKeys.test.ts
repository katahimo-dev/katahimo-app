import { describe, expect, it } from 'vitest';
import {
  authenticateIntegrationApiKey,
  createIntegrationApiKey,
  issueIntegrationApiToken,
  listIntegrationApiKeys,
  revokeIntegrationApiKey,
  tenantIdOfIntegrationApiToken,
} from './integrationApiKeys';
import { createTestContext } from './testContext';

describe('外部システム連携の API キー', () => {
  it('トークンは kth_<テナントID>_<乱数> で、テナントIDを取り出せる(形の違うものは null)', () => {
    const tenantId = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b';
    const token = issueIntegrationApiToken(tenantId);
    expect(token).toMatch(/^kth_0192a3b4c5d67e8f9a0b1c2d3e4f5a6b_[A-Za-z0-9_-]{43}$/);
    expect(issueIntegrationApiToken(tenantId)).not.toBe(token);
    expect(tenantIdOfIntegrationApiToken(token)).toBe(tenantId);
    expect(tenantIdOfIntegrationApiToken(`${token}x`)).toBeNull();
    expect(tenantIdOfIntegrationApiToken('kth_short_abc')).toBeNull();
    expect(tenantIdOfIntegrationApiToken('')).toBeNull();
  });

  it('発行したトークンで認証でき、最終利用の時刻が残る。DB にはトークンを残さない', async () => {
    const ctx = createTestContext();
    const { key, token } = await createIntegrationApiKey(ctx.deps, 'test-tenant', {
      name: ' RESERVA 本番 ',
      customerSource: 'reserva',
      createdBy: 'operator-1',
    });
    expect(key).toMatchObject({ name: 'RESERVA 本番', customerSource: 'reserva', lastUsedAt: null });
    expect(JSON.stringify(ctx.data().integrationApiKeys)).not.toContain(token.slice(-20));
    expect(ctx.appLog.byAction('tenant.api_key.created')).toEqual([
      expect.objectContaining({ level: 'SECURITY', actorType: 'operator' }),
    ]);
    expect(JSON.stringify(ctx.appLog.entries)).not.toContain(token);

    const result = await authenticateIntegrationApiKey(ctx.deps, token);
    expect(result).toEqual({
      ok: true,
      key: { tenantId: ctx.tenantId, apiKeyId: key.id, name: 'RESERVA 本番', customerSource: 'reserva' },
    });
    expect((await listIntegrationApiKeys(ctx.deps, 'test-tenant'))[0]?.lastUsedAt).toEqual(ctx.clock.now);
  });

  it('無い・形の違う・別のテナントの ID を差し替えた・失効したキーは断り、WARN を残す', async () => {
    const ctx = createTestContext();
    const other = ctx.db.addTenant({ slug: 'other' });
    const { key, token } = await createIntegrationApiKey(ctx.deps, 'test-tenant', {
      name: 'k',
      customerSource: 'external_api',
      createdBy: 'op',
    });
    const forged = token.replace(ctx.tenantId.replaceAll('-', ''), other.id.replaceAll('-', ''));
    expect(await authenticateIntegrationApiKey(ctx.deps, null)).toMatchObject({
      ok: false,
      reason: 'missing',
    });
    expect(await authenticateIntegrationApiKey(ctx.deps, 'Bearer x')).toMatchObject({ reason: 'malformed' });
    expect(await authenticateIntegrationApiKey(ctx.deps, forged)).toMatchObject({
      reason: 'unknown_key',
      tenantId: null,
    });

    const revoked = await revokeIntegrationApiKey(ctx.deps, 'test-tenant', key.id);
    expect(revoked.revokedAt).toEqual(ctx.clock.now);
    expect(await authenticateIntegrationApiKey(ctx.deps, token)).toMatchObject({
      reason: 'revoked',
      tenantId: ctx.tenantId,
    });
    expect(ctx.appLog.byAction('tenant.api_key.revoked')).toHaveLength(1);
    // もう一度失効させても記録は増えない
    await revokeIntegrationApiKey(ctx.deps, 'test-tenant', key.id);
    expect(ctx.appLog.byAction('tenant.api_key.revoked')).toHaveLength(1);
    expect(ctx.appLog.byAction('integration.auth_failed').map((e) => e.details?.reason)).toEqual([
      'missing',
      'malformed',
      'unknown_key',
      'revoked',
    ]);
    await expect(revokeIntegrationApiKey(ctx.deps, 'test-tenant', 'no-such-id')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('利用停止中のテナントのキーは断る。名前・取込元の誤りは発行しない', async () => {
    const ctx = createTestContext();
    const { token } = await createIntegrationApiKey(ctx.deps, 'test-tenant', {
      name: 'k',
      customerSource: 'external_api',
      createdBy: 'op',
    });
    ctx.setTenantStatus('suspended');
    expect(await authenticateIntegrationApiKey(ctx.deps, token)).toMatchObject({
      reason: 'tenant_suspended',
    });
    await expect(
      createIntegrationApiKey(ctx.deps, 'test-tenant', { name: 'k', customerSource: 'csv', createdBy: 'op' }),
    ).rejects.toMatchObject({ reason: 'invalid_source' });
    await expect(
      createIntegrationApiKey(ctx.deps, 'test-tenant', {
        name: '  ',
        customerSource: 'reserva',
        createdBy: 'op',
      }),
    ).rejects.toMatchObject({ reason: 'invalid_name' });
  });

  it('同じ送信元IPの認証の失敗が上限に達したら一時ロックし、ロック中は確かめず・ログも残さない(WARN はロックの始まりに1回)', async () => {
    const ctx = createTestContext();
    const deps = {
      ...ctx.deps,
      rateLimits: {
        ...ctx.deps.rateLimits,
        integrationAuthFailureIp: { name: 'iaf', limit: 3, windowMs: 60_000, lockMs: 60_000 },
      },
    };
    const { token } = await createIntegrationApiKey(ctx.deps, 'test-tenant', {
      name: 'k',
      customerSource: 'external_api',
      createdBy: 'op',
    });
    const meta = { ip: '203.0.113.9' };
    // 成功は数えない(枠を返す)
    for (let i = 0; i < 5; i++) {
      expect(await authenticateIntegrationApiKey(deps, token, meta)).toMatchObject({ ok: true });
    }
    const wrong = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    for (let i = 0; i < 3; i++) {
      expect(await authenticateIntegrationApiKey(deps, wrong, meta)).toMatchObject({ reason: 'unknown_key' });
    }
    const runsBefore = ctx.uow.runs;
    for (let i = 0; i < 10; i++) {
      expect(await authenticateIntegrationApiKey(deps, wrong, meta)).toMatchObject({
        ok: false,
        reason: 'locked',
        retryAfterMs: expect.any(Number),
      });
    }
    // 正しいキーでもロック中は断る(DB での確認はしない)
    expect(await authenticateIntegrationApiKey(deps, token, meta)).toMatchObject({ reason: 'locked' });
    expect(ctx.uow.runs).toBe(runsBefore);
    expect(ctx.appLog.byAction('integration.auth_failed')).toHaveLength(3);
    expect(ctx.appLog.byAction('integration.auth_locked')).toEqual([
      expect.objectContaining({
        level: 'WARN',
        ip: '203.0.113.9',
        details: { rule: 'iaf', limit: 3, lockMs: 60_000 },
      }),
    ]);
    // 別の送信元IPは断らない
    expect(await authenticateIntegrationApiKey(deps, token, { ip: '203.0.113.10' })).toMatchObject({
      ok: true,
    });
    // IPv6 は /64 ごとに数える(同じ /64 の別のアドレスもロック中)
    const v6 = (ip: string) => authenticateIntegrationApiKey(deps, wrong, { ip });
    for (let i = 1; i <= 3; i++) await v6(`2001:db8:5:5::${i}`);
    expect(await authenticateIntegrationApiKey(deps, token, { ip: '2001:db8:5:5:ffff::1' })).toMatchObject({
      reason: 'locked',
    });
    expect(await authenticateIntegrationApiKey(deps, token, { ip: '2001:db8:5:6::1' })).toMatchObject({
      ok: true,
    });
    // ロックが明けたら確かめる
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 60_000);
    expect(await authenticateIntegrationApiKey(deps, token, meta)).toMatchObject({ ok: true });
  });
});
