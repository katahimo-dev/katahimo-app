import type {
  CustomerPatchInput,
  CustomerRecord,
  CustomerRepositoryPort,
  EncryptedField,
  NewCustomerInput,
} from '@katahimo/core/ports';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { customers } from '../schema';

type CustomerRow = typeof customers.$inferSelect;

function encField(ciphertext: string | null, keyVersion: number | null): EncryptedField | null {
  return ciphertext && keyVersion != null ? { ciphertext, keyVersion } : null;
}

function toRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    externalSource: row.externalSource,
    externalId: row.externalId,
    name: row.name,
    familyName: row.familyName,
    givenName: row.givenName,
    familyNameKana: row.familyNameKana,
    givenNameKana: row.givenNameKana,
    email: row.email,
    phone: row.phone,
    addressDetail: row.addressDetail,
    city: row.city,
    parkingArea: row.parkingArea,
    parkingDetail: row.parkingDetail,
    emergencyContact: encField(row.emergencyContactCiphertext, row.emergencyContactKeyVersion),
    emergencyContactRelation: encField(
      row.emergencyContactRelationCiphertext,
      row.emergencyContactRelationKeyVersion,
    ),
    evacuationSite: encField(row.evacuationSiteCiphertext, row.evacuationSiteKeyVersion),
    memo: encField(row.memoCiphertext, row.memoKeyVersion),
    benefitMemberId: encField(row.benefitMemberIdCiphertext, row.benefitMemberIdKeyVersion),
    address2: row.address2,
    address2StartDate: row.address2StartDate,
    address2EndDate: row.address2EndDate,
    latLng: encField(row.latLngCiphertext, row.latLngKeyVersion),
    memberType: row.memberType,
    memberStatus: row.memberStatus,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    gender: row.gender,
    ageBracket: row.ageBracket,
    registeredAt: row.registeredAt,
    externalLastUpdatedAt: row.externalLastUpdatedAt,
    deactivatedAt: row.deactivatedAt,
  };
}

/**
 * NewCustomerInput/CustomerPatchInputをDrizzleのinsert/update値に変換する。
 *
 * usecases側(buildCustomerRecordFields)は必ず全フィールドを明示的に値かnullで埋めてから
 * 渡してくるため(未着手フィールドがundefinedのまま残ることはない)、update()も含めて
 * 「渡された値で全項目を上書きする」という単純な変換で正しい。CSV再取込のように、
 * 取込元の最新状態をそのまま反映する用途ではこれが正しい挙動(部分パッチではなく全件上書き)。
 */
function toColumnValues(input: NewCustomerInput | CustomerPatchInput) {
  return {
    externalSource: input.externalSource,
    externalId: input.externalId,
    familyNameKana: input.familyNameKana ?? null,
    givenNameKana: input.givenNameKana ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    addressDetail: input.addressDetail ?? null,
    city: input.city ?? null,
    parkingArea: input.parkingArea ?? null,
    parkingDetail: input.parkingDetail ?? null,
    emergencyContactCiphertext: input.emergencyContact?.ciphertext ?? null,
    emergencyContactKeyVersion: input.emergencyContact?.keyVersion ?? null,
    emergencyContactRelationCiphertext: input.emergencyContactRelation?.ciphertext ?? null,
    emergencyContactRelationKeyVersion: input.emergencyContactRelation?.keyVersion ?? null,
    evacuationSiteCiphertext: input.evacuationSite?.ciphertext ?? null,
    evacuationSiteKeyVersion: input.evacuationSite?.keyVersion ?? null,
    memoCiphertext: input.memo?.ciphertext ?? null,
    memoKeyVersion: input.memo?.keyVersion ?? null,
    benefitMemberIdCiphertext: input.benefitMemberId?.ciphertext ?? null,
    benefitMemberIdKeyVersion: input.benefitMemberId?.keyVersion ?? null,
    address2: input.address2 ?? null,
    address2StartDate: input.address2StartDate ?? null,
    address2EndDate: input.address2EndDate ?? null,
    latLngCiphertext: input.latLng?.ciphertext ?? null,
    latLngKeyVersion: input.latLng?.keyVersion ?? null,
    memberType: input.memberType ?? null,
    memberStatus: input.memberStatus ?? null,
    paymentMethod: input.paymentMethod ?? null,
    paymentStatus: input.paymentStatus ?? null,
    gender: input.gender ?? null,
    ageBracket: input.ageBracket ?? null,
    registeredAt: input.registeredAt ?? null,
    externalLastUpdatedAt: input.externalLastUpdatedAt ?? null,
  };
}

export class DrizzleCustomerRepository implements CustomerRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewCustomerInput): Promise<CustomerRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(customers)
        .values({
          tenantId: input.tenantId,
          name: input.name,
          familyName: input.familyName,
          givenName: input.givenName,
          ...toColumnValues(input),
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('顧客の作成に失敗しました');
      return toRecord(row);
    });
  }

  async findById(tenantId: string, customerId: string): Promise<CustomerRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findByFamilyName(tenantId: string, familyName: string): Promise<CustomerRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.familyName, familyName)));
      return rows.map(toRecord);
    });
  }

  async findByExternalId(
    tenantId: string,
    externalSource: string,
    externalId: string,
  ): Promise<CustomerRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.externalSource, externalSource), eq(customers.externalId, externalId)))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async listActiveExternalIds(tenantId: string, externalSource: string): Promise<string[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ externalId: customers.externalId })
        .from(customers)
        .where(and(eq(customers.externalSource, externalSource), isNull(customers.deactivatedAt)));
      return rows.map((r) => r.externalId).filter((id): id is string => id !== null);
    });
  }

  async listActive(tenantId: string): Promise<CustomerRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(customers).where(isNull(customers.deactivatedAt));
      return rows.map(toRecord);
    });
  }

  async update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(customers)
        .set({
          ...toColumnValues(patch),
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.familyName !== undefined && { familyName: patch.familyName }),
          ...(patch.givenName !== undefined && { givenName: patch.givenName }),
        })
        .where(eq(customers.id, customerId))
        .returning();
      const row = rows[0];
      if (!row) throw new Error(`顧客が見つかりません: ${customerId}`);
      return toRecord(row);
    });
  }

  async deactivate(tenantId: string, customerId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx.update(customers).set({ deactivatedAt: new Date() }).where(eq(customers.id, customerId));
    });
  }
}
