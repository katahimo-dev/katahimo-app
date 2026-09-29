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
}

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
    const { staff, appointments } = await this.loadStaffAppointments(query, {
      strict: options?.strict === true,
    });
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

    // 勤怠記録を書く経路(fresh)では、読めないカレンダーがあれば予定が欠けたまま記録しないよう失敗させる。
    const { staff, appointments } = await this.loadStaffAppointments(query, { strict: fresh });
    // fresh は地図の結果も使い回さない(公式記録の距離はその時点で調べた値にする)。
    // 🔄 最新にする(forceRefresh)はキャッシュを読まずに調べ、結果は以後の閲覧のために書き直す。
    const mapsCache: MapsResultCache | null = fresh
      ? null
      : { cache: this.deps.mapsCache, tenantId: query.tenantId, read: !forceRefresh };
    return {
      success: true,
      date: query.date,
      staffName: query.staffName,
      appointments: staff ? await this.withRoutes(query, staff, appointments, mapsCache) : [],
    };
  }

  private async loadStaffAppointments(
    query: ScheduleQuery,
    { strict }: { strict: boolean },
  ): Promise<StaffAppointments> {
    const directory = await this.deps.directory.load(query.tenantId);
    // 対象はスタッフIDで決める(同姓同名でも取り違えない)。予定との突き合わせはカレンダーの文字列のため氏名で行う
    const staff = directory.staff.find((s) => s.id === query.staffId) ?? null;
    if (!staff) return { staff: null, appointments: [] };

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

  private async withRoutes(
    query: ScheduleQuery,
    staff: ScheduleStaff,
    appointments: Appointment[],
    mapsCache: MapsResultCache | null,
  ) {
    const calculator = new RouteCalculator(this.deps.maps, query.date, staff.travelMode, mapsCache);
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
