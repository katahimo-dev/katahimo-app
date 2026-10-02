import type {
  ConfirmedStaffVisit,
  ReservationCreateInput,
  ReservationRepository,
} from '@katahimo/core/ports';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { customers, reservationAssignments, reservations } from '../../schema';
import { TenantBound } from './base';

/** 予定として見せる予約の状態(確定・実施済み)。 */
const VISIBLE_RESERVATION_STATUSES = ['confirmed', 'done'] as const;

/**
 * 予約とスタッフの割当(マッチング拡張の表、doc/10_マッチング拡張設計.md)。いまは公開デモの予定の登録と
 * SCHEDULE_PROVIDER=database の予定の取得だけ。管理者の割当のアプリを作るときにここへ足していく。
 */
export class DrizzleReservationRepository extends TenantBound implements ReservationRepository {
  async create(input: ReservationCreateInput): Promise<void> {
    await this.tx.insert(reservations).values({
      tenantId: this.tenantId,
      id: input.id,
      customerId: input.customerId,
      status: input.status,
      scheduledPeriod: { start: input.period.start, end: input.period.end },
      businessDate: input.businessDate,
      requiredStaffCount: Math.max(1, input.assignments.length),
    });
    if (input.assignments.length === 0) return;
    await this.tx.insert(reservationAssignments).values(
      input.assignments.map((a) => ({
        tenantId: this.tenantId,
        id: a.id,
        reservationId: input.id,
        staffId: a.staffId,
        period: { start: input.period.start, end: input.period.end },
        status: 'confirmed' as const,
        confirmedAt: a.confirmedAt,
      })),
    );
  }

  async listConfirmedVisitsForStaffOnDate(
    staffId: string,
    businessDate: string,
  ): Promise<ConfirmedStaffVisit[]> {
    const rows = await this.tx
      .select({
        reservationId: reservations.id,
        customerId: reservations.customerId,
        customerDisplayName: customers.displayName,
        period: reservationAssignments.period,
      })
      .from(reservationAssignments)
      .innerJoin(
        reservations,
        and(
          eq(reservations.tenantId, reservationAssignments.tenantId),
          eq(reservations.id, reservationAssignments.reservationId),
        ),
      )
      .innerJoin(
        customers,
        and(eq(customers.tenantId, reservations.tenantId), eq(customers.id, reservations.customerId)),
      )
      .where(
        and(
          eq(reservationAssignments.tenantId, this.tenantId),
          eq(reservationAssignments.staffId, staffId),
          eq(reservationAssignments.status, 'confirmed'),
          eq(reservations.businessDate, businessDate),
          inArray(reservations.status, [...VISIBLE_RESERVATION_STATUSES]),
        ),
      )
      .orderBy(asc(sql`lower(${reservationAssignments.period})`), asc(reservations.id));
    return rows.flatMap((row) => {
      const { start, end } = row.period;
      // 割当の時間帯は CHECK で有限(無限の境界は来ない)
      if (!start || !end) return [];
      return [
        {
          reservationId: row.reservationId,
          customerId: row.customerId,
          customerDisplayName: row.customerDisplayName,
          start,
          end,
        },
      ];
    });
  }
}
