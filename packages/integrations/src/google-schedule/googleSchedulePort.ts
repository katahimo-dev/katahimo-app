import type { Appointment, CalendarEventSource } from '@katahimo/core/domain';
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
import { type CalendarSource, resolveCalendarSources } from './calendarSources';
import { RouteCalculator } from './routeCalculator';

/** GAS版 ROUTE_RESULT_CACHE_TTL_SEC と同じ2時間(ブラウザ側のキャッシュ期限とも揃えている)。 */
export const ROUTE_RESULT_CACHE_TTL_SECONDS = 2 * 60 * 60;

export interface GoogleSchedulePortDeps {
  calendar: GoogleCalendarPort;
  maps: MapsPort;
  directory: ScheduleDirectoryPort;
  /** ルート結果の共有キャッシュ(閲覧用。fresh指定時は読み書きしない)。 */
  routeCache: CachePort;
  appLog: AppLogPort;
  /** 環境変数 GOOGLE_CALENDAR_IDS で指定されたカレンダー(staff.calendar_id と合わせて読む)。 */
  calendarSources: CalendarSource[];
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
}

/**
 * Google Calendar API + Google Maps Platform で「今日/明日の予定」を計算する SchedulePort。
 * GAS版 RouteSearch.js の getScheduleForStaffOnDate / getScheduleWithRouteForStaffOnDate を
 * 置き換え、GasBridgeSchedulePort と同じ形の結果を返す。分類・経路の組み立ては
 * @katahimo/core の domain/schedule(GAS版ロジックの移植)に任せ、ここは取得と実行だけを行う。
 */
export class GoogleSchedulePort implements SchedulePort {
  constructor(private readonly deps: GoogleSchedulePortDeps) {}

  async getSchedule(
    target: ScheduleTarget,
    dateString: string,
    options?: ScheduleRequestOptions,
  ): Promise<ScheduleLightResult> {
    const query = parseQuery(target, dateString, options);
    const { staff, appointments } = await this.loadStaffAppointments(query, { strict: false });
    return {
      success: true,
      date: query.date,
      staffName: staff?.name ?? query.staffName,
      appointments: appointments.map(toLightAppointment),
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
    const cacheKey = routeCacheKey(query);

    if (!fresh && !forceRefresh) {
      const cached = await this.deps.routeCache.get<ScheduleWithRouteResult>(cacheKey);
      if (cached) return cached;
    }

    // 勤怠記録を書く経路(fresh)では、読めないカレンダーがあれば予定が欠けたまま記録しないよう失敗させる。
    const { staff, appointments } = await this.loadStaffAppointments(query, { strict: fresh });
    const result: ScheduleWithRouteResult = {
      success: true,
      date: query.date,
      staffName: query.staffName,
      appointments: staff ? await this.withRoutes(query, staff, appointments) : [],
    };

    if (!fresh) await this.deps.routeCache.set(cacheKey, result, ROUTE_RESULT_CACHE_TTL_SECONDS);
    return result;
  }

  private async loadStaffAppointments(
    query: ScheduleQuery,
    { strict }: { strict: boolean },
  ): Promise<StaffAppointments> {
    const directory = await this.deps.directory.load(query.tenantId);
    // 対象はスタッフIDで決める(同姓同名でも取り違えない)。予定との突き合わせはカレンダーの文字列のため氏名で行う
    const staff = directory.staff.find((s) => s.id === query.staffId) ?? null;
    if (!staff) return { staff: null, appointments: [] };

    const sources = resolveCalendarSources(this.deps.calendarSources, directory.staff);
    const events = await this.readCalendars(query, sources, strict);
    const all = classifyCalendarEvents(events, directory.customers);
    return { staff, appointments: appointmentsForStaff(all, staff.name) };
  }

  private async readCalendars(
    query: ScheduleQuery,
    sources: CalendarSource[],
    strict: boolean,
  ): Promise<CalendarEventSource[]> {
    const range = jstDayRange(query.date);
    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          return { source, list: await this.deps.calendar.listEvents(source.calendarId, range) };
        } catch (e) {
          return { source, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    const events: CalendarEventSource[] = [];
    for (const { source, list, error } of results) {
      if (list) {
        events.push({ ownerName: source.ownerName ?? list.calendarName, events: list.events });
        continue;
      }
      if (strict) throw new Error(`カレンダーを読み込めませんでした: ${error}`);
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
    return events;
  }

  private async withRoutes(query: ScheduleQuery, staff: ScheduleStaff, appointments: Appointment[]) {
    const calculator = new RouteCalculator(this.deps.maps, query.date, staff.travelMode);
    const withRoutes = await Promise.all(
      planRouteLegs(appointments, staff.home).map(async (plan) =>
        toAppointmentWithRoute(plan.appointment, await calculator.summarizePlan(plan)),
      ),
    );
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

/** 結果の形を変えたら v を上げる(古い形のキャッシュを読ませないため。GAS版 RS_ROUTE_V2_ と同じ考え方)。 */
function routeCacheKey({ tenantId, staffId, date }: ScheduleQuery): string {
  return `schedule-route:v2:${tenantId}:${staffId}:${date}`;
}
