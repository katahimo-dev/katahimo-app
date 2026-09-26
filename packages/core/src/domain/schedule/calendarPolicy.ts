/**
 * テナントごとのカレンダーの設定(platform.tenants.calendar_settings。運用担当者だけが CLI で変える)。
 *
 * 予定はプラットフォームの1つの Google の ID(サービスアカウント)で全テナントのカレンダーを読むため、
 * テナントの管理者がスタッフに好きなカレンダーIDを設定できると、別のテナントのカレンダーの予定を読めてしまう。
 * スタッフの「予定を読むカレンダー」は許可の一覧(完全一致のIDか、ドメインの後方一致)に合うものだけにする。
 */

/** 共有カレンダー(スタッフのカレンダー以外に読むもの。RESERVA の予約カレンダー等)。 */
export interface SharedCalendarSource {
  calendarId: string;
  /** 予定の持ち主のスタッフ名(無ければカレンダーの名前)。 */
  ownerName?: string;
}

export interface TenantCalendarSettings {
  sharedCalendars: SharedCalendarSource[];
  /** スタッフに設定できるカレンダー。'@example.co.jp' はドメインの後方一致、それ以外は完全一致。小文字。 */
  allowedStaffCalendars: string[];
}

export const EMPTY_CALENDAR_SETTINGS: TenantCalendarSettings = {
  sharedCalendars: [],
  allowedStaffCalendars: [],
};

/**
 * 誰でも作れるカレンダーのドメイン。後方一致の規則には使えない(他のテナント・他人のカレンダーも合ってしまう)。
 * これらは完全一致のIDとして1つずつ登録する。
 */
export const GENERIC_CALENDAR_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'group.calendar.google.com',
  'resource.calendar.google.com',
  'group.v.calendar.google.com',
  'import.calendar.google.com',
] as const;

const CALENDAR_ID = /^[^\s@,=]+@[^\s@,=]+\.[^\s@,=]+$/;
const DOMAIN_RULE = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function normalizeCalendarId(value: string): string {
  return value.trim().toLowerCase();
}

/** 許可の規則を確かめる。正しければ正規化した規則、誤りなら理由。 */
export function parseCalendarAllowRule(
  raw: string,
): { ok: true; rule: string } | { ok: false; message: string } {
  const rule = normalizeCalendarId(raw);
  if (rule.startsWith('@')) {
    if (!DOMAIN_RULE.test(rule)) return { ok: false, message: `ドメインの形が正しくありません: ${raw}` };
    const domain = rule.slice(1);
    if (GENERIC_CALENDAR_DOMAINS.some((generic) => domain === generic || domain.endsWith(`.${generic}`))) {
      return {
        ok: false,
        message: `${rule} は誰でも作れるカレンダーのドメインのため、後方一致には使えません。カレンダーIDを1つずつ登録してください`,
      };
    }
    return { ok: true, rule };
  }
  if (!CALENDAR_ID.test(rule)) return { ok: false, message: `カレンダーIDの形が正しくありません: ${raw}` };
  return { ok: true, rule };
}

/** 共有カレンダーの指定(`カレンダーID` か `カレンダーID=持ち主のスタッフ名`)を読む。 */
export function parseSharedCalendar(
  raw: string,
): { ok: true; source: SharedCalendarSource } | { ok: false; message: string } {
  const separator = raw.indexOf('=');
  const calendarId = normalizeCalendarId(separator < 0 ? raw : raw.slice(0, separator));
  const ownerName = separator < 0 ? '' : raw.slice(separator + 1).trim();
  if (!CALENDAR_ID.test(calendarId))
    return { ok: false, message: `カレンダーIDの形が正しくありません: ${raw}` };
  return { ok: true, source: { calendarId, ...(ownerName ? { ownerName } : {}) } };
}

/** スタッフにこのカレンダーを設定してよいか(許可の一覧に完全一致か、ドメインの後方一致)。 */
export function isStaffCalendarAllowed(settings: TenantCalendarSettings, calendarId: string): boolean {
  const id = normalizeCalendarId(calendarId);
  return settings.allowedStaffCalendars.some((rule) =>
    rule.startsWith('@') ? id.endsWith(rule) && CALENDAR_ID.test(id) : id === rule,
  );
}

/** DB の jsonb を読む(形の崩れた要素・誤った規則は捨てる。読むときにも規則を確かめ直す)。 */
export function parseTenantCalendarSettings(raw: unknown): TenantCalendarSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const shared = Array.isArray(value.sharedCalendars) ? value.sharedCalendars : [];
  const allowed = Array.isArray(value.allowedStaffCalendars) ? value.allowedStaffCalendars : [];
  return {
    sharedCalendars: shared.flatMap((entry) => {
      const source = (entry ?? {}) as Record<string, unknown>;
      if (typeof source.calendarId !== 'string' || !CALENDAR_ID.test(normalizeCalendarId(source.calendarId)))
        return [];
      const ownerName = typeof source.ownerName === 'string' ? source.ownerName.trim() : '';
      return [{ calendarId: normalizeCalendarId(source.calendarId), ...(ownerName ? { ownerName } : {}) }];
    }),
    allowedStaffCalendars: allowed.flatMap((rule) => {
      if (typeof rule !== 'string') return [];
      const parsed = parseCalendarAllowRule(rule);
      return parsed.ok ? [parsed.rule] : [];
    }),
  };
}
