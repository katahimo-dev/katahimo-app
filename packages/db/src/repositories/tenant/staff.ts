import { conflict, STALE_WRITE_MESSAGE } from '@katahimo/core/domain';
import type {
  NewStaffInput,
  StaffCredentials,
  StaffPatch,
  StaffRecord,
  StaffRepository,
  StaffRouteProfile,
} from '@katahimo/core/ports';
import { and, asc, eq, gt, isNull, or, type SQL, sql } from 'drizzle-orm';
import { staff, staffCalendars, staffCredentials, staffLoginEmails } from '../../schema';
import { TenantBound } from './base';

const primaryEmail = sql<string>`(select e.email from ${staffLoginEmails} e
  where e.tenant_id = ${staff.tenantId} and e.staff_id = ${staff.id} and e.is_primary)`;
const altEmail = sql<string | null>`(select e.email from ${staffLoginEmails} e
  where e.tenant_id = ${staff.tenantId} and e.staff_id = ${staff.id} and not e.is_primary
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
  rowVersion: staff.rowVersion,
};

export class DrizzleStaffRepository extends TenantBound implements StaffRepository {
  private select(where: SQL | undefined) {
    return this.tx
      .select(staffColumns)
      .from(staff)
      .where(and(eq(staff.tenantId, this.tenantId), where))
      .orderBy(asc(staff.displayName), asc(staff.id));
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
      phone: input.phone ?? null,
      role: input.role,
      retiredOn: input.retiredOn ?? null,
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
    const { email, altEmail: alt, ...columns } = patch;
    const updated = await this.tx
      .update(staff)
      .set({ ...columns, rowVersion: sql`${staff.rowVersion} + 1` })
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
    return this.tx
      .select({
        id: staff.id,
        displayName: staff.displayName,
        homeAddress: staff.homeAddress,
        homeGeoEnc: staff.homeGeoEnc,
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
  }
}
