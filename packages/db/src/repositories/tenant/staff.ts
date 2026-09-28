import { conflict, STALE_WRITE_MESSAGE } from '@katahimo/core/domain';
import type {
  NewStaffInput,
  StaffCredentials,
  StaffDeleteOutcome,
  StaffHome,
  StaffPasswordStatus,
  StaffPatch,
  StaffRecord,
  StaffRepository,
  StaffRouteProfile,
} from '@katahimo/core/ports';
import { and, asc, eq, gt, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { FOREIGN_KEY_VIOLATION, pgErrorOf } from '../../errors';
import {
  aiPromptRevisions,
  careRecordRevisions,
  entityChanges,
  staff,
  staffCalendars,
  staffCredentials,
  staffLoginEmails,
} from '../../schema';
import { TenantBound } from './base';

// 外側の列は表名つきで書く(drizzle は単一表の select では列を表名なしで出すため、副問い合わせの中では
// staff_login_emails の列と取り違えうる)
const primaryEmail = sql<string>`(select e.email from ${staffLoginEmails} e
  where e.tenant_id = "staff"."tenant_id" and e.staff_id = "staff"."id" and e.is_primary)`;
const altEmail = sql<string | null>`(select e.email from ${staffLoginEmails} e
  where e.tenant_id = "staff"."tenant_id" and e.staff_id = "staff"."id" and not e.is_primary
  order by e.created_at, e.email limit 1)`;

const staffColumns = {
  id: staff.id,
  displayName: staff.displayName,
  familyName: staff.familyName,
  givenName: staff.givenName,
  familyNameKana: staff.familyNameKana,
  givenNameKana: staff.givenNameKana,
  email: primaryEmail,
  altEmail,
  phone: staff.phone,
  role: staff.role,
  retiredOn: staff.retiredOn,
  gender: staff.gender,
  homeAddress: staff.homeAddress,
  homeLat: staff.homeLat,
  homeLng: staff.homeLng,
  travelMode: staff.travelMode,
  rowVersion: staff.rowVersion,
};

type StaffRow = Omit<StaffRecord, 'homeGeo'> & { homeLat: number | null; homeLng: number | null };

function toRecord({ homeLat, homeLng, ...row }: StaffRow): StaffRecord {
  return { ...row, homeGeo: homeLat !== null && homeLng !== null ? { lat: homeLat, lng: homeLng } : null };
}

/** 自宅(住所・緯度経度・区画)を staff の列にする。 */
function homeColumns(home: StaffHome) {
  return {
    homeAddress: home.address,
    homeLat: home.geo?.lat ?? null,
    homeLng: home.geo?.lng ?? null,
    homeGeoCell: home.geoCell,
  };
}

export class DrizzleStaffRepository extends TenantBound implements StaffRepository {
  private async select(where: SQL | undefined): Promise<StaffRecord[]> {
    const rows = await this.tx
      .select(staffColumns)
      .from(staff)
      .where(and(eq(staff.tenantId, this.tenantId), where))
      .orderBy(asc(staff.displayName), asc(staff.id));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<StaffRecord | null> {
    return (await this.select(eq(staff.id, id)))[0] ?? null;
  }

  async findByLoginEmail(email: string): Promise<StaffRecord | null> {
    const owner = this.tx
      .select({ staffId: staffLoginEmails.staffId })
      .from(staffLoginEmails)
      .where(and(eq(staffLoginEmails.tenantId, this.tenantId), eq(staffLoginEmails.email, email)));
    return (await this.select(sql`${staff.id} = (${owner})`))[0] ?? null;
  }

  listAll(): Promise<StaffRecord[]> {
    return this.select(undefined);
  }

  listActiveOn(date: string): Promise<StaffRecord[]> {
    return this.select(or(isNull(staff.retiredOn), gt(staff.retiredOn, date)));
  }

  async create(input: NewStaffInput): Promise<StaffRecord> {
    await this.tx.insert(staff).values({
      tenantId: this.tenantId,
      id: input.id,
      displayName: input.displayName,
      familyName: input.familyName,
      givenName: input.givenName,
      familyNameKana: input.familyNameKana ?? null,
      givenNameKana: input.givenNameKana ?? null,
      phone: input.phone ?? null,
      role: input.role,
      retiredOn: input.retiredOn ?? null,
      travelMode: input.travelMode ?? null,
      gender: input.gender ?? null,
      ...(input.home ? homeColumns(input.home) : {}),
    });
    await this.replaceEmails(input.id, input.email, input.altEmail ?? null);
    await this.tx.insert(staffCredentials).values({
      tenantId: this.tenantId,
      staffId: input.id,
      passwordHash: input.passwordHash ?? null,
      legacyPasswordHash: input.legacyPasswordHash ?? null,
      passwordChangedAt: input.passwordHash ? sql`now()` : null,
    });
    return (await this.findById(input.id)) as StaffRecord;
  }

  /** ログイン用メールを置き換える(重複は主キー違反 → mapDatabaseError が conflict にする)。 */
  private async replaceEmails(staffId: string, email: string, alt: string | null): Promise<void> {
    await this.tx
      .delete(staffLoginEmails)
      .where(and(eq(staffLoginEmails.tenantId, this.tenantId), eq(staffLoginEmails.staffId, staffId)));
    const rows = [{ tenantId: this.tenantId, email, staffId, isPrimary: true }];
    if (alt && alt !== email) rows.push({ tenantId: this.tenantId, email: alt, staffId, isPrimary: false });
    await this.tx.insert(staffLoginEmails).values(rows);
  }

  async update(id: string, patch: StaffPatch, expectedVersion?: number): Promise<StaffRecord | null> {
    const current = await this.findById(id);
    if (!current) return null;
    if (expectedVersion !== undefined && current.rowVersion !== expectedVersion) {
      throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    }
    const { email, altEmail: alt, home, ...columns } = patch;
    const updated = await this.tx
      .update(staff)
      .set({ ...columns, ...(home ? homeColumns(home) : {}), rowVersion: sql`${staff.rowVersion} + 1` })
      .where(
        and(eq(staff.tenantId, this.tenantId), eq(staff.id, id), eq(staff.rowVersion, current.rowVersion)),
      )
      .returning({ id: staff.id });
    if (updated.length === 0) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    if (email !== undefined || alt !== undefined) {
      await this.replaceEmails(id, email ?? current.email, alt === undefined ? current.altEmail : alt);
    }
    return this.findById(id);
  }

  async releaseLoginEmails(staffIds: readonly string[]): Promise<void> {
    if (staffIds.length === 0) return;
    await this.tx
      .delete(staffLoginEmails)
      .where(
        and(eq(staffLoginEmails.tenantId, this.tenantId), inArray(staffLoginEmails.staffId, [...staffIds])),
      );
  }

  /** 外部キーを持たない変更の履歴に、このスタッフが変更者として残っているか。 */
  private async appearsInHistory(id: string): Promise<boolean> {
    const [row] = await this.tx.execute<{ referenced: boolean }>(sql`select
      exists (select 1 from ${entityChanges} where ${entityChanges.tenantId} = ${this.tenantId} and ${entityChanges.changedBy} = ${id})
      or exists (select 1 from ${careRecordRevisions} where ${careRecordRevisions.tenantId} = ${this.tenantId} and ${careRecordRevisions.changedBy} = ${id})
      or exists (select 1 from ${aiPromptRevisions} where ${aiPromptRevisions.tenantId} = ${this.tenantId} and ${aiPromptRevisions.createdBy} = ${id})
      as referenced`);
    return Boolean(row?.referenced);
  }

  async deleteIfUnreferenced(id: string): Promise<StaffDeleteOutcome> {
    if (!(await this.findById(id))) return 'not_found';
    if (await this.appearsInHistory(id)) return 'referenced';
    try {
      // 業務の記録の参照の検査は外部キーに任せる(記録の表が増えても漏れない)。失敗しても UoW のトランザクションを
      // 続けられるよう、セーブポイントの中で消す
      const deleted = await this.tx.transaction((sp) =>
        sp
          .delete(staff)
          .where(and(eq(staff.tenantId, this.tenantId), eq(staff.id, id)))
          .returning({ id: staff.id }),
      );
      return deleted.length > 0 ? 'deleted' : 'not_found';
    } catch (error) {
      if (pgErrorOf(error)?.code === FOREIGN_KEY_VIOLATION) return 'referenced';
      throw error;
    }
  }

  async lockActiveAdmins(date: string): Promise<{ id: string; retiredOn: string | null }[]> {
    return this.tx
      .select({ id: staff.id, retiredOn: staff.retiredOn })
      .from(staff)
      .where(
        and(
          eq(staff.tenantId, this.tenantId),
          eq(staff.role, 'admin'),
          or(isNull(staff.retiredOn), gt(staff.retiredOn, date)),
        ),
      )
      .orderBy(asc(staff.id))
      .for('update');
  }

  async listPasswordStatuses(): Promise<Map<string, StaffPasswordStatus>> {
    const rows = await this.tx
      .select({
        staffId: staffCredentials.staffId,
        hasPassword: sql<boolean>`${staffCredentials.passwordHash} is not null`,
        hasLegacy: sql<boolean>`${staffCredentials.legacyPasswordHash} is not null`,
      })
      .from(staffCredentials)
      .where(eq(staffCredentials.tenantId, this.tenantId));
    return new Map(
      rows.map((r) => [r.staffId, r.hasPassword ? 'set' : r.hasLegacy ? 'legacy' : 'unset'] as const),
    );
  }

  async getCredentials(staffId: string): Promise<StaffCredentials | null> {
    const rows = await this.tx
      .select({
        passwordHash: staffCredentials.passwordHash,
        legacyPasswordHash: staffCredentials.legacyPasswordHash,
      })
      .from(staffCredentials)
      .where(and(eq(staffCredentials.tenantId, this.tenantId), eq(staffCredentials.staffId, staffId)));
    return rows[0] ?? null;
  }

  private credentials(staffId: string) {
    return and(eq(staffCredentials.tenantId, this.tenantId), eq(staffCredentials.staffId, staffId));
  }

  async setPasswordHash(staffId: string, passwordHash: string): Promise<void> {
    await this.tx
      .update(staffCredentials)
      .set({
        passwordHash,
        legacyPasswordHash: null,
        passwordChangedAt: sql`now()`,
        failedCount: 0,
        lockedUntil: null,
      })
      .where(this.credentials(staffId));
  }

  async setLegacyPasswordHash(staffId: string, legacyPasswordHash: string): Promise<void> {
    await this.tx
      .update(staffCredentials)
      .set({ legacyPasswordHash })
      .where(and(this.credentials(staffId), isNull(staffCredentials.passwordHash)));
  }

  async recordLoginFailure(staffId: string, lockedUntil: Date | null): Promise<void> {
    await this.tx
      .update(staffCredentials)
      .set({
        failedCount: sql`${staffCredentials.failedCount} + 1`,
        ...(lockedUntil ? { lockedUntil } : {}),
      })
      .where(this.credentials(staffId));
  }

  async recordLoginSuccess(staffId: string): Promise<void> {
    await this.tx
      .update(staffCredentials)
      .set({ failedCount: 0, lockedUntil: null })
      .where(
        and(
          this.credentials(staffId),
          sql`(${staffCredentials.failedCount} > 0 or ${staffCredentials.lockedUntil} is not null)`,
        ),
      );
  }

  async listRouteProfiles(): Promise<StaffRouteProfile[]> {
    const rows = await this.tx
      .select({
        id: staff.id,
        displayName: staff.displayName,
        homeAddress: staff.homeAddress,
        homeLat: staff.homeLat,
        homeLng: staff.homeLng,
        travelMode: staff.travelMode,
        scheduleCalendarId: staffCalendars.calendarId,
        retiredOn: staff.retiredOn,
      })
      .from(staff)
      .leftJoin(
        staffCalendars,
        and(
          eq(staffCalendars.tenantId, staff.tenantId),
          eq(staffCalendars.staffId, staff.id),
          eq(staffCalendars.purpose, 'schedule'),
        ),
      )
      .where(eq(staff.tenantId, this.tenantId))
      .orderBy(asc(staff.displayName), asc(staff.id));
    return rows.map(({ homeLat, homeLng, ...row }) => ({
      ...row,
      homeGeo: homeLat !== null && homeLng !== null ? { lat: homeLat, lng: homeLng } : null,
    }));
  }
}
