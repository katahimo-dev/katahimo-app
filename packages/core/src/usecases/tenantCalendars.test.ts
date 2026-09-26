import { describe, expect, it } from 'vitest';
import { updateTenantCalendarSettings } from './tenantCalendars';
import { createTestContext } from './testContext';
import { FakeTenantCalendarSettingsStore } from './testDoubles';

describe('テナントのカレンダーの設定(運用担当者)', () => {
  const setup = () => {
    const ctx = createTestContext();
    const deps = { ...ctx.deps, calendarSettings: new FakeTenantCalendarSettingsStore(ctx.db) };
    return { ctx, deps };
  };

  it('共有カレンダー・許可を足し引きし、SECURITY で件数だけを残す', async () => {
    const { ctx, deps } = setup();
    const first = await updateTenantCalendarSettings(deps, 'test-tenant', {
      addShared: ['reserva@group.calendar.google.com', 'yamada@cutest.co.jp=山田 花子'],
      allow: ['@cutest.co.jp', 'Private@gmail.com'],
    });
    expect(first.settings).toEqual({
      sharedCalendars: [
        { calendarId: 'reserva@group.calendar.google.com' },
        { calendarId: 'yamada@cutest.co.jp', ownerName: '山田 花子' },
      ],
      allowedStaffCalendars: ['@cutest.co.jp', 'private@gmail.com'],
    });
    const second = await updateTenantCalendarSettings(deps, 'test-tenant', {
      removeShared: ['yamada@cutest.co.jp'],
      disallow: ['private@gmail.com'],
    });
    expect(second.settings).toEqual({
      sharedCalendars: [{ calendarId: 'reserva@group.calendar.google.com' }],
      allowedStaffCalendars: ['@cutest.co.jp'],
    });
    expect(await ctx.uow.run(ctx.tenantId, (r) => r.calendarSettings())).toEqual(second.settings);
    expect(ctx.appLog.byAction('tenant.calendar_settings.updated').at(-1)).toMatchObject({
      level: 'SECURITY',
      details: { sharedCalendars: 1, allowedStaffCalendars: 1 },
    });
    expect(JSON.stringify(ctx.appLog.entries)).not.toContain('reserva@');
  });

  it('誰でも作れるドメインの後方一致・形の誤り・無いテナントは断り、何も変えない', async () => {
    const { ctx, deps } = setup();
    await expect(
      updateTenantCalendarSettings(deps, 'test-tenant', { allow: ['@gmail.com'] }),
    ).rejects.toMatchObject({
      reason: 'invalid_allow_rule',
    });
    await expect(
      updateTenantCalendarSettings(deps, 'test-tenant', { addShared: ['not-a-calendar'] }),
    ).rejects.toMatchObject({ reason: 'invalid_shared_calendar' });
    await expect(updateTenantCalendarSettings(deps, 'nothing', {})).rejects.toMatchObject({
      reason: 'tenant_not_found',
    });
    expect(ctx.db.calendarSettings.get(ctx.tenantId)).toBeUndefined();
  });
});
