import { createHash } from 'node:crypto';
import type { Appointment, CalendarEvent, CalendarEventSource } from '@katahimo/core/domain';
import {
  appointmentsForStaff,
  classifyCalendarEvents,
  isValidBusinessDate,
  jstDayRange,
  planRouteLegs,
  toAppointmentWithRoute,
  toLightAppointment,
} from '@katahimo/core/domain';
import type {
  AppLogPort,
  CachePort,
  CalendarEventList,
  GoogleCalendarPort,
  MapsPort,
  ScheduleDirectoryPort,
  ScheduleLightResult,
  SchedulePort,
  ScheduleRequestOptions,
  ScheduleStaff,
  ScheduleTarget,
  ScheduleWithRouteOptions,
  ScheduleWithRouteResult,
} from '@katahimo/core/ports';
import { type CalendarSource, resolveCalendarSources, selectViewCalendarSources } from './calendarSources';
import { type MapsResultCache, RouteCalculator } from './routeCalculator';

export interface GoogleSchedulePortDeps {
  calendar: GoogleCalendarPort;
  maps: MapsPort;
  directory: ScheduleDirectoryPort;
  /**
   * 区間ごとのルート・住所ごとのジオコーディングの結果の共有キャッシュ(RouteCalculator)。
   * 閲覧は読み書き、forceRefresh は書くだけ、fresh(公式記録への書き込み)は読みも書きもしない。
   * 予定(カレンダー)そのものはキャッシュしない。
   */
  mapsCache: CachePort;
  /**
   * 閲覧用の、テナント × カレンダー × 日付ごとのイベント一覧の短期キャッシュ(60秒)。予定タブは開くたび・戻るたびに
   * 対象スタッフのカレンダーと共有カレンダーを読むため、同じ時間帯に何度・何人が開いても(共有カレンダーや
   * 他の人の予定を見る管理者の分も)Calendar API の呼び出しが開いた回数分にならないようにする。
   * 担当変更の反映はこの分(最大60秒)遅れる。🔄 最新にする(forceRefresh)は読まずに書き直し、strict / fresh
   * (お知らせのジョブ・公式記録への書き込み)は読みも書きもしない。
   */
  calendarCache: CachePort;
  appLog: AppLogPort;
}

interface ScheduleQuery {
  tenantId: string;
  staffId: string;
  staffName: string;
  date: string;
}

interface StaffAppointments {
  staff: ScheduleStaff | null;
  appointments: Appointment[];
  /** 閲覧で読めないカレンダーがあった(予定が欠けているかもしれない) */
  partial: boolean;
}

/** カレンダーの読み方: strict = 読めなければ失敗・キャッシュなし / view = 飛ばす・キャッシュを読み書き / refresh = 飛ばす・書くだけ */
type CalendarReadMode = 'strict' | 'view' | 'refresh';

/** イベント一覧の短期キャッシュの期間(閲覧のみ)。 */
export const CALENDAR_EVENTS_CACHE_TTL_SECONDS = 60;

/**
 * Google Calendar API + Google Maps Platform で「今日/明日の予定」を計算する SchedulePort。
 * GAS版 RouteSearch.js の getScheduleForStaffOnDate / getScheduleWithRouteForStaffOnDate を
 * 置き換え、GasBridgeSchedulePort と同じ形の結果を返す。分類・経路の組み立ては
 * @katahimo/core の domain/schedule(GAS版ロジックの移植)に任せ、ここは取得と実行だけを行う。
 *
 * GAS版はスタッフ×日の「予定+ルート」を丸ごと2時間キャッシュしていたが、それでは担当変更がすぐ出ないため、
 * 閲覧でも予定は毎回カレンダーから読む。地図APIの呼び出し(従量課金)は区間・住所ごとのキャッシュで減らす。
 */
export class GoogleSchedulePort implements SchedulePort {
  constructor(private readonly deps: GoogleSchedulePortDeps) {}

  async getSchedule(
    target: ScheduleTarget,
    dateString: string,
    options?: ScheduleRequestOptions,
  ): Promise<ScheduleLightResult> {
    const query = parseQuery(target, dateString, options);
    const { staff, appointments, partial } = await this.loadStaffAppointments(
      query,
      options?.strict === true ? 'strict' : 'view',
    );
    return {
      success: true,
      date: query.date,
      staffName: staff?.name ?? query.staffName,
      appointments: appointments.map(toLightAppointment),
      ...(partial ? { partial: true } : {}),
    };
  }

  async getScheduleWithRoute(
    target: ScheduleTarget,
    dateString: string,
    forceRefresh: boolean,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleWithRouteResult> {
    const query = parseQuery(target, dateString, options);
    const fresh = options?.fresh === true;

    // 勤怠記録を書く経路(fresh)では、読めないカレンダーがあれば予定が欠けたまま記録しないよう失敗させる。
    // 🔄 最新にする(forceRefresh)はカレンダーも地図の結果もキャッシュを読まずに調べ、結果は以後の閲覧のために書き直す。
    const { staff, appointments, partial } = await this.loadStaffAppointments(
      query,
      fresh ? 'strict' : forceRefresh ? 'refresh' : 'view',
    );
    // fresh は地図の結果も使い回さない(公式記録の距離はその時点で調べた値にする)。
    const mapsCache: MapsResultCache | null = fresh
      ? null
      : { cache: this.deps.mapsCache, tenantId: query.tenantId, read: !forceRefresh };
    return {
      success: true,
      date: query.date,
      staffName: query.staffName,
      appointments: staff ? await this.withRoutes(query, staff, appointments, mapsCache, options) : [],
      ...(partial ? { partial: true } : {}),
    };
  }

  private async loadStaffAppointments(
    query: ScheduleQuery,
    mode: CalendarReadMode,
  ): Promise<StaffAppointments> {
    const directory = await this.deps.directory.load(query.tenantId);
    // 対象はスタッフIDで決める(同姓同名でも取り違えない)。予定との突き合わせはカレンダーの文字列のため氏名で行う
    const staff = directory.staff.find((s) => s.id === query.staffId) ?? null;
    if (!staff) return { staff: null, appointments: [], partial: false };

    const { sources, disallowedStaffIds } = resolveCalendarSources(
      directory.calendarSettings,
      directory.staff,
    );
    // 対象のスタッフ自身のカレンダーが許可から外れていれば残す(他のスタッフの分は毎回の記録にしない)
    if (disallowedStaffIds.includes(staff.id)) {
      await this.deps.appLog.write({
        tenantId: query.tenantId,
        level: 'WARN',
        action: 'calendar.staff_calendar_not_allowed',
        targetStaffId: staff.id,
        details: { source: 'schedule' },
      });
    }
    // 閲覧(view / refresh)は他のスタッフの予定のカレンダーを読まない(自分のカレンダーと共有カレンダー全部。selectViewCalendarSources)。
    // strict(翌日の予定のお知らせ)と fresh(出勤簿への同期)は取りこぼさないよう全カレンダーを読む。
    // お知らせは1日1回のジョブで読み込み数の心配が小さく、内容を出勤簿に入る予定(夜間の同期)と揃えるため絞らない。
    const readSources = mode === 'strict' ? sources : selectViewCalendarSources(sources, staff);
    const { events, partial } = await this.readCalendars(query, readSources, mode);
    const all = classifyCalendarEvents(events, directory.customers);
    return { staff, appointments: appointmentsForStaff(all, staff.name), partial };
  }

  private async readCalendars(
    query: ScheduleQuery,
    sources: CalendarSource[],
    mode: CalendarReadMode,
  ): Promise<{ events: CalendarEventSource[]; partial: boolean }> {
    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          return { source, list: await this.listEvents(query, source.calendarId, mode) };
        } catch (e) {
          return { source, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    const events: CalendarEventSource[] = [];
    let partial = false;
    for (const { source, list, error } of results) {
      if (list) {
        events.push({ ownerName: source.ownerName ?? list.calendarName, events: list.events });
        continue;
      }
      if (mode === 'strict') throw new Error(`カレンダーを読み込めませんでした: ${error}`);
      partial = true;
      await this.deps.appLog.write({
        tenantId: query.tenantId,
        level: 'WARN',
        action: 'schedule.calendar_read_failed',
        targetStaffId: source.staffId ?? null,
        details: {
          date: query.date,
          calendarId: source.staffId ? undefined : source.calendarId,
          message: error,
        },
      });
    }
    return { events, partial };
  }

  /** 1つのカレンダーのその日のイベント(閲覧は60秒の短期キャッシュを使う。読めなかったときは覚えない)。 */
  private async listEvents(
    query: ScheduleQuery,
    calendarId: string,
    mode: CalendarReadMode,
  ): Promise<CalendarEventList> {
    if (mode === 'strict') return this.deps.calendar.listEvents(calendarId, jstDayRange(query.date));
    const key = calendarEventsCacheKey(query.tenantId, calendarId, query.date);
    if (mode === 'view') {
      const cached = await this.deps.calendarCache.get<StoredEventList>(key);
      if (cached) return reviveEventList(cached);
    }
    const list = await this.deps.calendar.listEvents(calendarId, jstDayRange(query.date));
    await this.deps.calendarCache.set(key, storeEventList(list), CALENDAR_EVENTS_CACHE_TTL_SECONDS);
    return list;
  }

  private async withRoutes(
    query: ScheduleQuery,
    staff: ScheduleStaff,
    appointments: Appointment[],
    mapsCache: MapsResultCache | null,
    options: ScheduleWithRouteOptions | undefined,
  ) {
    const calculator = new RouteCalculator(this.deps.maps, query.date, staff.travelMode, mapsCache);
    const withRoutes = await Promise.all(
      planRouteLegs(appointments, staff.home).map(async (plan) =>
        toAppointmentWithRoute(plan.appointment, await calculator.summarizePlan(plan)),
      ),
    );
    options?.onMapsUsage?.({ ...calculator.usage });
    if (calculator.failures.length > 0) {
      await this.deps.appLog.write({
        tenantId: query.tenantId,
        level: 'WARN',
        action: 'schedule.route_leg_failed',
        targetStaffId: staff.id,
        details: { date: query.date, failures: calculator.failures },
      });
    }
    return withRoutes;
  }
}

function parseQuery(
  target: ScheduleTarget,
  dateString: string,
  options?: ScheduleRequestOptions,
): ScheduleQuery {
  const trimmedName = target.staffName.trim();
  if (!target.staffId || !trimmedName) throw new Error('対象のスタッフが指定されていません。');
  if (!isValidBusinessDate(dateString)) {
    throw new Error('dateString が不正です。YYYY-MM-DD 形式で指定してください。');
  }
  if (!options?.tenantId) throw new Error('GoogleSchedulePort には tenantId の指定が必要です。');
  return { tenantId: options.tenantId, staffId: target.staffId, staffName: trimmedName, date: dateString };
}

/**
 * イベント一覧のキャッシュのキー。カレンダーID(メールアドレスのこともある)をキーにそのまま残さないよう SHA-256 にする。
 * 値の形を変えたら v を上げる。
 */
function calendarEventsCacheKey(tenantId: string, calendarId: string, date: string): string {
  const digest = createHash('sha256').update(`${tenantId}\u0000${calendarId}\u0000${date}`).digest('hex');
  return `calendar-events:v1:${digest}`;
}

/** CachePort の値は JSON で表せるものに限るため、日時は ISO 文字列にして入れる。 */
type StoredEvent = Omit<CalendarEvent, 'start' | 'end'> & { start: string; end: string };
interface StoredEventList {
  calendarName: string;
  events: StoredEvent[];
}

function storeEventList(list: CalendarEventList): StoredEventList {
  return {
    calendarName: list.calendarName,
    events: list.events.map((e) => ({ ...e, start: e.start.toISOString(), end: e.end.toISOString() })),
  };
}

function reviveEventList(stored: StoredEventList): CalendarEventList {
  return {
    calendarName: stored.calendarName,
    events: stored.events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) })),
  };
}
