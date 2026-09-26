import type { ArchiveReason, CustomerSource } from '@katahimo/core/domain';
import { conflict, STALE_WRITE_MESSAGE } from '@katahimo/core/domain';
import type {
  CareRecipientRecord,
  CareRecipientRepository,
  CustomerAddressInput,
  CustomerAddressRecord,
  CustomerAddressRepository,
  CustomerContactRecord,
  CustomerContactRepository,
  CustomerPatch,
  CustomerRecord,
  CustomerRepository,
  CustomerSourceRecord,
  CustomerSourceRecordRepository,
  CustomerSummary,
  NewCustomerInput,
} from '@katahimo/core/ports';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  careRecipients,
  customerAddresses,
  customerContacts,
  customerSourceRecords,
  customers,
} from '../../schema';
import { TenantBound } from './base';

const customerColumns = {
  id: customers.id,
  displayName: customers.displayName,
  familyName: customers.familyName,
  givenName: customers.givenName,
  familyNameKana: customers.familyNameKana,
  givenNameKana: customers.givenNameKana,
  email: customers.email,
  phone: customers.phone,
  memo: customers.memo,
  benefitMemberId: customers.benefitMemberId,
  evacuationSite: customers.evacuationSite,
  archivedAt: customers.archivedAt,
  archiveReason: customers.archiveReason,
  rowVersion: customers.rowVersion,
};

/** 一覧に出す市区町村: 主の住所(無ければ自宅)。 */
// 外側の列は表名つきで書く(drizzle は単一表の select では列を表名なしで出すため、副問い合わせの中では
// customer_addresses の列と取り違える)
const primaryCity = sql<string | null>`(select a.city from ${customerAddresses} a
  where a.tenant_id = "customers"."tenant_id" and a.customer_id = "customers"."id"
  order by a.is_primary desc, (a.kind = 'home') desc, a.created_at limit 1)`;

export class DrizzleCustomerRepository extends TenantBound implements CustomerRepository {
  private byId(id: string) {
    return and(eq(customers.tenantId, this.tenantId), eq(customers.id, id));
  }

  async findById(id: string): Promise<CustomerRecord | null> {
    const rows = await this.tx.select(customerColumns).from(customers).where(this.byId(id));
    return rows[0] ?? null;
  }

  private summaries(where: ReturnType<typeof and>) {
    return this.tx
      .select({
        id: customers.id,
        displayName: customers.displayName,
        phone: customers.phone,
        city: primaryCity,
      })
      .from(customers)
      .where(and(eq(customers.tenantId, this.tenantId), isNull(customers.archivedAt), where))
      .orderBy(asc(customers.familyNameKana), asc(customers.displayName), asc(customers.id));
  }

  listActiveSummaries(): Promise<CustomerSummary[]> {
    return this.summaries(undefined);
  }

  findByFamilyName(familyName: string): Promise<CustomerSummary[]> {
    return this.summaries(eq(customers.familyName, familyName));
  }

  async create(input: NewCustomerInput): Promise<CustomerRecord> {
    const [row] = await this.tx
      .insert(customers)
      .values({ tenantId: this.tenantId, ...input })
      .returning(customerColumns);
    return row as CustomerRecord;
  }

  async update(id: string, patch: CustomerPatch, expectedVersion?: number): Promise<CustomerRecord> {
    const rows = await this.tx
      .update(customers)
      .set({ ...patch, rowVersion: sql`${customers.rowVersion} + 1` })
      .where(
        and(
          this.byId(id),
          expectedVersion === undefined ? undefined : eq(customers.rowVersion, expectedVersion),
        ),
      )
      .returning(customerColumns);
    if (!rows[0]) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    return rows[0];
  }

  async archive(id: string, reason: ArchiveReason, at: Date): Promise<void> {
    await this.tx
      .update(customers)
      .set({ archivedAt: at, archiveReason: reason, rowVersion: sql`${customers.rowVersion} + 1` })
      .where(and(this.byId(id), isNull(customers.archivedAt)));
  }

  async unarchive(id: string): Promise<void> {
    await this.tx
      .update(customers)
      .set({ archivedAt: null, archiveReason: null, rowVersion: sql`${customers.rowVersion} + 1` })
      .where(and(this.byId(id), sql`${customers.archivedAt} is not null`));
  }
}

const sourceColumns = {
  id: customerSourceRecords.id,
  customerId: customerSourceRecords.customerId,
  source: customerSourceRecords.source,
  externalId: customerSourceRecords.externalId,
  attributes: customerSourceRecords.attributes,
  externalRegisteredAt: customerSourceRecords.externalRegisteredAt,
  externalUpdatedAt: customerSourceRecords.externalUpdatedAt,
};

export class DrizzleCustomerSourceRecordRepository
  extends TenantBound
  implements CustomerSourceRecordRepository
{
  async findByExternalId(source: CustomerSource, externalId: string): Promise<CustomerSourceRecord | null> {
    const rows = await this.tx
      .select(sourceColumns)
      .from(customerSourceRecords)
      .where(
        and(
          eq(customerSourceRecords.tenantId, this.tenantId),
          eq(customerSourceRecords.source, source),
          eq(customerSourceRecords.externalId, externalId),
        ),
      );
    return rows[0] ?? null;
  }

  async findByCustomerId(customerId: string): Promise<CustomerSourceRecord | null> {
    const rows = await this.tx
      .select(sourceColumns)
      .from(customerSourceRecords)
      .where(
        and(
          eq(customerSourceRecords.tenantId, this.tenantId),
          eq(customerSourceRecords.customerId, customerId),
        ),
      )
      .orderBy(asc(customerSourceRecords.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async mapExternalIds(
    source: CustomerSource,
  ): Promise<Map<string, { customerId: string; archived: boolean }>> {
    const rows = await this.tx
      .select({
        externalId: customerSourceRecords.externalId,
        customerId: customerSourceRecords.customerId,
        archived: sql<boolean>`${customers.archivedAt} is not null`,
      })
      .from(customerSourceRecords)
      .innerJoin(
        customers,
        and(
          eq(customers.tenantId, customerSourceRecords.tenantId),
          eq(customers.id, customerSourceRecords.customerId),
        ),
      )
      .where(
        and(eq(customerSourceRecords.tenantId, this.tenantId), eq(customerSourceRecords.source, source)),
      );
    return new Map(rows.map((r) => [r.externalId, { customerId: r.customerId, archived: r.archived }]));
  }

  async upsert(
    input: Omit<CustomerSourceRecord, 'id'> & { id: string; lastImportRunId: string | null },
  ): Promise<void> {
    await this.tx
      .insert(customerSourceRecords)
      .values({ tenantId: this.tenantId, ...input })
      .onConflictDoUpdate({
        target: [
          customerSourceRecords.tenantId,
          customerSourceRecords.source,
          customerSourceRecords.externalId,
        ],
        set: {
          customerId: input.customerId,
          attributes: input.attributes,
          externalRegisteredAt: input.externalRegisteredAt,
          externalUpdatedAt: input.externalUpdatedAt,
          lastImportRunId: input.lastImportRunId,
        },
      });
  }
}

const addressColumns = {
  id: customerAddresses.id,
  customerId: customerAddresses.customerId,
  kind: customerAddresses.kind,
  postalCode: customerAddresses.postalCode,
  prefecture: customerAddresses.prefecture,
  city: customerAddresses.city,
  addressLine: customerAddresses.addressLine,
  building: customerAddresses.building,
  parkingArea: customerAddresses.parkingArea,
  parkingDetail: customerAddresses.parkingDetail,
  lat: customerAddresses.lat,
  lng: customerAddresses.lng,
  geoCell: customerAddresses.geoCell,
  valid: customerAddresses.valid,
  isPrimary: customerAddresses.isPrimary,
};

type AddressRow = Omit<CustomerAddressRecord, 'geo'> & { lat: number | null; lng: number | null };

function toAddressRecord({ lat, lng, ...row }: AddressRow): CustomerAddressRecord {
  return { ...row, geo: lat !== null && lng !== null ? { lat, lng } : null };
}

/** 緯度経度(geo)を lat / lng の列にする。patch に geo が無ければ列に触れない。 */
function addressValues<T extends Partial<CustomerAddressInput>>({ geo, ...rest }: T) {
  return geo === undefined ? rest : { ...rest, lat: geo?.lat ?? null, lng: geo?.lng ?? null };
}

export class DrizzleCustomerAddressRepository extends TenantBound implements CustomerAddressRepository {
  async listByCustomer(customerId: string): Promise<CustomerAddressRecord[]> {
    const rows = await this.tx
      .select(addressColumns)
      .from(customerAddresses)
      .where(and(eq(customerAddresses.tenantId, this.tenantId), eq(customerAddresses.customerId, customerId)))
      .orderBy(asc(customerAddresses.createdAt), asc(customerAddresses.id));
    return rows.map(toAddressRecord);
  }

  async listForActiveCustomers(): Promise<CustomerAddressRecord[]> {
    const rows = await this.tx
      .select(addressColumns)
      .from(customerAddresses)
      .innerJoin(
        customers,
        and(
          eq(customers.tenantId, customerAddresses.tenantId),
          eq(customers.id, customerAddresses.customerId),
        ),
      )
      .where(and(eq(customerAddresses.tenantId, this.tenantId), isNull(customers.archivedAt)))
      .orderBy(asc(customerAddresses.customerId), asc(customerAddresses.createdAt));
    return rows.map(toAddressRecord);
  }

  async insert(input: CustomerAddressInput): Promise<void> {
    await this.tx.insert(customerAddresses).values({ tenantId: this.tenantId, ...addressValues(input) });
  }

  async update(id: string, patch: Partial<Omit<CustomerAddressInput, 'id' | 'customerId'>>): Promise<void> {
    await this.tx
      .update(customerAddresses)
      .set(addressValues(patch))
      .where(and(eq(customerAddresses.tenantId, this.tenantId), eq(customerAddresses.id, id)));
  }

  async delete(id: string): Promise<void> {
    await this.tx
      .delete(customerAddresses)
      .where(and(eq(customerAddresses.tenantId, this.tenantId), eq(customerAddresses.id, id)));
  }
}

export class DrizzleCustomerContactRepository extends TenantBound implements CustomerContactRepository {
  listByCustomer(customerId: string): Promise<CustomerContactRecord[]> {
    return this.tx
      .select({
        id: customerContacts.id,
        customerId: customerContacts.customerId,
        relation: customerContacts.relation,
        name: customerContacts.name,
        phone: customerContacts.phone,
        notes: customerContacts.notes,
        isEmergency: customerContacts.isEmergency,
        sortOrder: customerContacts.sortOrder,
      })
      .from(customerContacts)
      .where(and(eq(customerContacts.tenantId, this.tenantId), eq(customerContacts.customerId, customerId)))
      .orderBy(asc(customerContacts.sortOrder), asc(customerContacts.id));
  }

  async insert(input: CustomerContactRecord): Promise<void> {
    await this.tx.insert(customerContacts).values({ tenantId: this.tenantId, ...input });
  }

  async update(id: string, patch: Partial<Omit<CustomerContactRecord, 'id' | 'customerId'>>): Promise<void> {
    await this.tx
      .update(customerContacts)
      .set(patch)
      .where(and(eq(customerContacts.tenantId, this.tenantId), eq(customerContacts.id, id)));
  }

  async delete(id: string): Promise<void> {
    await this.tx
      .delete(customerContacts)
      .where(and(eq(customerContacts.tenantId, this.tenantId), eq(customerContacts.id, id)));
  }
}

export class DrizzleCareRecipientRepository extends TenantBound implements CareRecipientRepository {
  listByCustomer(
    customerId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<CareRecipientRecord[]> {
    return this.tx
      .select({
        id: careRecipients.id,
        customerId: careRecipients.customerId,
        name: careRecipients.name,
        nameKana: careRecipients.nameKana,
        birthDate: careRecipients.birthDate,
        sex: careRecipients.sex,
        allergy: careRecipients.allergy,
        needs: careRecipients.needs,
        sortOrder: careRecipients.sortOrder,
        archivedAt: careRecipients.archivedAt,
      })
      .from(careRecipients)
      .where(
        and(
          eq(careRecipients.tenantId, this.tenantId),
          eq(careRecipients.customerId, customerId),
          options.includeArchived ? undefined : isNull(careRecipients.archivedAt),
        ),
      )
      .orderBy(asc(careRecipients.sortOrder), asc(careRecipients.id));
  }

  async insert(input: Omit<CareRecipientRecord, 'archivedAt'>): Promise<void> {
    await this.tx.insert(careRecipients).values({ tenantId: this.tenantId, ...input });
  }

  async update(id: string, patch: Partial<Omit<CareRecipientRecord, 'id' | 'customerId'>>): Promise<void> {
    await this.tx
      .update(careRecipients)
      .set(patch)
      .where(and(eq(careRecipients.tenantId, this.tenantId), eq(careRecipients.id, id)));
  }
}
