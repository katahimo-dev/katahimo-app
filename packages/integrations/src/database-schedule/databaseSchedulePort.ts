import type { Appointment, Place } from '@katahimo/core/domain';
import {
  estimatePlanLegs,
  isValidBusinessDate,
  planRouteLegs,
  toAppointmentWithRoute,
  toLightAppointment,
} from '@katahimo/core/domain';
import type {
  ScheduleDirectoryPort,
  ScheduleLightResult,
  SchedulePort,
  ScheduleRequestOptions,
  ScheduleStaff,
  ScheduleTarget,
  ScheduleWithRouteOptions,
  ScheduleWithRouteResult,
  UnitOfWorkPort,
} from '@katahimo/core/ports';

export interface DatabaseSchedulePortDeps {
  /** スタッフの確定した訪問(reservations + reservation_assignments)を読む。 */
  uow: UnitOfWorkPort;
  /** 顧客の場所・スタッフの自宅と移動手段(予定のマスタ)。 */
  directory: ScheduleDirectoryPort;
}

interface ScheduleQuery {
  tenantId: string;
  staffId: string;
  staffName: string;
  date: string;
}

const NO_PLACE: Place = { address: '', latLng: null };

/**
 * DB の予約(reservations とスタッフの確定した割当 reservation_assignments)を「今日/明日の予定」として返す
 * SchedulePort(SCHEDULE_PROVIDER=database)。Google カレンダーを用意しない環境のためのもの。予約は今後のマッチング
 * (管理者の割当)のアプリが入れる(いまはテストだけが入れる)。
 *
 * - 予定はすべて顧客の訪問(CUSTOMER APPOINTMENT)。顧客の住所・緯度経度は予定のマスタ(ScheduleDirectoryPort)から引く。
 * - 区間の距離・所要時間は地図APIを呼ばずに緯度経度から見積もる(domain/schedule/estimatedLeg.ts。目安の値)。
 *   緯度経度の無い場所の区間は算出不可('')。
 * - DB が予定の正本なので、部分的な結果(partial)は無く、strict / fresh / forceRefresh でも読み方は変わらない。
 */
export class DatabaseSchedulePort implements SchedulePort {
  constructor(private readonly deps: DatabaseSchedulePortDeps) {}

  async getSchedule(
    target: ScheduleTarget,
    dateString: string,
    options?: ScheduleRequestOptions,
  ): Promise<ScheduleLightResult> {
    const query = parseQuery(target, dateString, options);
    const { staff, appointments } = await this.loadStaffAppointments(query);
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
    _forceRefresh: boolean,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleWithRouteResult> {
    const query = parseQuery(target, dateString, options);
    const { staff, appointments } = await this.loadStaffAppointments(query);
    return {
      success: true,
      date: query.date,
      staffName: staff?.name ?? query.staffName,
      appointments: staff
        ? planRouteLegs(appointments, staff.home).map((plan) =>
            toAppointmentWithRoute(plan.appointment, estimatePlanLegs(plan, query.date, staff.travelMode)),
          )
        : [],
    };
  }

  private async loadStaffAppointments(
    query: ScheduleQuery,
  ): Promise<{ staff: ScheduleStaff | null; appointments: Appointment[] }> {
    const directory = await this.deps.directory.load(query.tenantId);
    const staff = directory.staff.find((s) => s.id === query.staffId) ?? null;
    if (!staff) return { staff: null, appointments: [] };

    const visits = await this.deps.uow.run(query.tenantId, (r) =>
      r.reservations.listConfirmedVisitsForStaffOnDate(staff.id, query.date),
    );
    const customerOf = new Map(directory.customers.map((c) => [c.recordId, c]));
    const appointments = visits.map((visit): Appointment => {
      // 予定のマスタに無い(アーカイブされた)顧客は、名前だけ出して場所は無しにする
      const customer = customerOf.get(visit.customerId);
      return {
        type: 'CUSTOMER APPOINTMENT',
        start: visit.start,
        end: visit.end,
        name: customer?.name ?? visit.customerDisplayName,
        customerId: customer?.customerId ?? '',
        place: customer?.place ?? NO_PLACE,
        reservaUrl: '',
        assigneeNames: [staff.name],
      };
    });
    return { staff, appointments };
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
  if (!options?.tenantId) throw new Error('DatabaseSchedulePort には tenantId の指定が必要です。');
  return { tenantId: options.tenantId, staffId: target.staffId, staffName: trimmedName, date: dateString };
}
