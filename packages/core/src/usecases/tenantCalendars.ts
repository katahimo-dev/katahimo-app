import {
  invalid,
  normalizeCalendarId,
  parseCalendarAllowRule,
  parseSharedCalendar,
  type TenantCalendarSettings,
} from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { TenantCalendarSettingsStore, TenantDirectoryPort } from '../ports/tenants';

export interface TenantCalendarDeps {
  tenants: TenantDirectoryPort;
  calendarSettings: TenantCalendarSettingsStore;
  appLog: AppLogPort;
}

/** 運用担当者の変更(CLI の引数そのまま。規則はここで確かめる)。 */
export interface TenantCalendarChanges {
  /** `カレンダーID` か `カレンダーID=持ち主のスタッフ名`。同じIDがあれば置き換える。 */
  addShared?: string[];
  removeShared?: string[];
  /** 完全一致のカレンダーID か '@ドメイン'(誰でも作れるドメインは不可)。 */
  allow?: string[];
  disallow?: string[];
}

/**
 * テナントのカレンダーの設定を読む・変える(運用担当者の `pnpm tenant:calendars`。テナントの管理者は変えられない)。
 * 変えたら SECURITY `tenant.calendar_settings.updated` を残す(カレンダーIDはメールアドレスのため件数だけ)。
 */
export async function updateTenantCalendarSettings(
  deps: TenantCalendarDeps,
  tenantSlug: string,
  changes: TenantCalendarChanges,
): Promise<{ tenantId: string; settings: TenantCalendarSettings }> {
  const tenant = await deps.tenants.findBySlug(tenantSlug.trim().toLowerCase());
  if (!tenant) throw invalid(`テナントが見つかりません: ${tenantSlug}`, undefined, 'tenant_not_found');
  const current = await deps.calendarSettings.get(tenant.id);

  const shared = new Map(current.sharedCalendars.map((s) => [s.calendarId, s]));
  for (const raw of changes.removeShared ?? []) shared.delete(normalizeCalendarId(raw));
  for (const raw of changes.addShared ?? []) {
    const parsed = parseSharedCalendar(raw);
    if (!parsed.ok) throw invalid(parsed.message, undefined, 'invalid_shared_calendar');
    shared.set(parsed.source.calendarId, parsed.source);
  }
  const allowed = new Set(current.allowedStaffCalendars);
  for (const raw of changes.disallow ?? []) allowed.delete(normalizeCalendarId(raw));
  for (const raw of changes.allow ?? []) {
    const parsed = parseCalendarAllowRule(raw);
    if (!parsed.ok) throw invalid(parsed.message, undefined, 'invalid_allow_rule');
    allowed.add(parsed.rule);
  }

  const settings: TenantCalendarSettings = {
    sharedCalendars: [...shared.values()],
    allowedStaffCalendars: [...allowed].sort(),
  };
  const changed = Object.values(changes).some((list) => (list ?? []).length > 0);
  if (changed) {
    await deps.calendarSettings.set(tenant.id, settings);
    await deps.appLog.write({
      tenantId: tenant.id,
      level: 'SECURITY',
      action: 'tenant.calendar_settings.updated',
      actorType: 'system',
      details: {
        sharedCalendars: settings.sharedCalendars.length,
        allowedStaffCalendars: settings.allowedStaffCalendars.length,
      },
    });
  }
  return { tenantId: tenant.id, settings };
}
