import type { EncryptedField } from '@katahimo/core/ports';
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import {
  type AvailabilityExceptionKind,
  staffAvailabilityExceptions,
  staffWeeklyAvailability,
  type TimeRange,
} from '../schema';
import { type InstantRange, overlapsRange } from './_rangeSql';

/**
 * スタッフの勤務可能時間帯(週次の枠+例外)の読み書き(doc/10)。将来のマッチングアプリ向けの土台。
 * core側のPortはまだ無いため型はこのファイルで定義する。
 */
export interface WeeklyAvailabilityRecord {
  id: string;
  tenantId: string;
  staffId: string;
  /** 0=日曜〜6=土曜。 */
  weekday: number;
  /** 'HH:MM:SS'(テナントのタイムゾーンの壁時計時刻)。 */
  startTime: string;
  endTime: string;
  /** 'YYYY-MM-DD'。 */
  effectiveFrom: string;
  /** 'YYYY-MM-DD'(その日を含む)。nullは無期限。 */
  effectiveTo: string | null;
}

export interface WeeklySlotInput {
  weekday: number;
  /** 'HH:MM' または 'HH:MM:SS'。 */
  startTime: string;
  endTime: string;
}

export interface AvailabilityExceptionRecord {
  id: string;
  tenantId: string;
  staffId: string;
  period: TimeRange;
  kind: AvailabilityExceptionKind;
  reason: EncryptedField | null;
}

export interface NewAvailabilityExceptionInput {
  tenantId: string;
  staffId: string;
  period: { start: Date; end: Date };
  kind: AvailabilityExceptionKind;
  reason?: EncryptedField | null;
}

function toWeeklyRecord(row: typeof staffWeeklyAvailability.$inferSelect): WeeklyAvailabilityRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

function toExceptionRecord(
  row: typeof staffAvailabilityExceptions.$inferSelect,
): AvailabilityExceptionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    period: row.period,
    kind: row.kind,
    reason:
      row.reasonCiphertext && row.reasonKeyVersion != null
        ? { ciphertext: row.reasonCiphertext, keyVersion: row.reasonKeyVersion }
        : null,
  };
}

export class DrizzleStaffAvailabilityRepository {
  constructor(private readonly db: Database) {}

  /**
   * 指定期間(両端の日付を含む 'YYYY-MM-DD')に1日でも有効な週次枠を返す。
   * どの日にどの枠が効くか(effective_from/toと曜日の突き合わせ)は呼び出し側で日ごとに判定する。
   */
  async listWeekly(
    tenantId: string,
    staffIds: string[],
    fromDate: string,
    toDate: string,
  ): Promise<WeeklyAvailabilityRecord[]> {
    if (staffIds.length === 0) return [];
    const t = staffWeeklyAvailability;
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(t)
        .where(
          and(
            inArray(t.staffId, staffIds),
            lte(t.effectiveFrom, toDate),
            or(isNull(t.effectiveTo), gte(t.effectiveTo, fromDate)),
          ),
        )
        .orderBy(asc(t.staffId), asc(t.weekday), asc(t.startTime));
      return rows.map(toWeeklyRecord);
    });
  }

  /**
   * effectiveFrom以降の週次枠を slots で置き換える(シフト体系の変更)。
   * - effectiveFromより前に始まり、effectiveFrom以降も有効な既存行は前日で打ち切る(履歴として残す)
   * - effectiveFrom以降に始まる既存行(未来の予定枠)は削除する
   * - slotsを effective_from=effectiveFrom, effective_to=null で追加する
   */
  async replaceWeekly(
    tenantId: string,
    staffId: string,
    effectiveFrom: string,
    slots: WeeklySlotInput[],
  ): Promise<WeeklyAvailabilityRecord[]> {
    const t = staffWeeklyAvailability;
    return withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(t)
        .set({ effectiveTo: sql`(${effectiveFrom}::date - 1)`, updatedAt: new Date() })
        .where(
          and(
            eq(t.staffId, staffId),
            lt(t.effectiveFrom, effectiveFrom),
            or(isNull(t.effectiveTo), gte(t.effectiveTo, effectiveFrom)),
          ),
        );
      await tx.delete(t).where(and(eq(t.staffId, staffId), gte(t.effectiveFrom, effectiveFrom)));
      if (slots.length === 0) return [];
      const rows = await tx
        .insert(t)
        .values(
          slots.map((slot) => ({
            tenantId,
            staffId,
            weekday: slot.weekday,
            startTime: slot.startTime,
            endTime: slot.endTime,
            effectiveFrom,
          })),
        )
        .returning();
      return rows.map(toWeeklyRecord);
    });
  }

  /** 指定時間帯に重なる例外(休み・臨時勤務)を返す。 */
  async listExceptions(
    tenantId: string,
    staffIds: string[],
    range: InstantRange,
  ): Promise<AvailabilityExceptionRecord[]> {
    if (staffIds.length === 0) return [];
    const t = staffAvailabilityExceptions;
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(t)
        .where(and(inArray(t.staffId, staffIds), overlapsRange(t.period, range)));
      return rows.map(toExceptionRecord);
    });
  }

  async createException(input: NewAvailabilityExceptionInput): Promise<AvailabilityExceptionRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(staffAvailabilityExceptions)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          period: input.period,
          kind: input.kind,
          reasonCiphertext: input.reason?.ciphertext ?? null,
          reasonKeyVersion: input.reason?.keyVersion ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('勤務可否の例外の保存に失敗しました');
      return toExceptionRecord(row);
    });
  }

  async deleteException(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx.delete(staffAvailabilityExceptions).where(eq(staffAvailabilityExceptions.id, id));
    });
  }
}
