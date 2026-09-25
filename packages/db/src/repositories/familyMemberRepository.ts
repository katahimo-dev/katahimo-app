import type {
  EncryptedField,
  FamilyMemberRecord,
  FamilyMemberRepositoryPort,
  NewFamilyMemberInput,
} from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { familyMembers } from '../schema';

type FamilyMemberRow = typeof familyMembers.$inferSelect;

function encField(ciphertext: string | null, keyVersion: number | null): EncryptedField | null {
  return ciphertext && keyVersion != null ? { ciphertext, keyVersion } : null;
}

function toRecord(row: FamilyMemberRow): FamilyMemberRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    name: { ciphertext: row.nameCiphertext, keyVersion: row.nameKeyVersion },
    dob: encField(row.dobCiphertext, row.dobKeyVersion),
    info: encField(row.infoCiphertext, row.infoKeyVersion),
  };
}

export class DrizzleFamilyMemberRepository implements FamilyMemberRepositoryPort {
  constructor(private readonly db: Database) {}

  async createMany(inputs: NewFamilyMemberInput[]): Promise<FamilyMemberRecord[]> {
    if (inputs.length === 0) return [];
    const tenantId = inputs[0]?.tenantId;
    if (!tenantId) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .insert(familyMembers)
        .values(
          inputs.map((input) => ({
            tenantId: input.tenantId,
            customerId: input.customerId,
            nameCiphertext: input.name.ciphertext,
            nameKeyVersion: input.name.keyVersion,
            dobCiphertext: input.dob?.ciphertext ?? null,
            dobKeyVersion: input.dob?.keyVersion ?? null,
            infoCiphertext: input.info?.ciphertext ?? null,
            infoKeyVersion: input.info?.keyVersion ?? null,
          })),
        )
        .returning();
      return rows.map(toRecord);
    });
  }

  async listByCustomerId(tenantId: string, customerId: string): Promise<FamilyMemberRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.tenantId, tenantId), eq(familyMembers.customerId, customerId)));
      return rows.map(toRecord);
    });
  }

  async replaceForCustomer(
    tenantId: string,
    customerId: string,
    inputs: NewFamilyMemberInput[],
  ): Promise<FamilyMemberRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(familyMembers)
        .where(and(eq(familyMembers.tenantId, tenantId), eq(familyMembers.customerId, customerId)));

      if (inputs.length === 0) return [];

      const rows = await tx
        .insert(familyMembers)
        .values(
          inputs.map((input) => ({
            tenantId: input.tenantId,
            customerId: input.customerId,
            nameCiphertext: input.name.ciphertext,
            nameKeyVersion: input.name.keyVersion,
            dobCiphertext: input.dob?.ciphertext ?? null,
            dobKeyVersion: input.dob?.keyVersion ?? null,
            infoCiphertext: input.info?.ciphertext ?? null,
            infoKeyVersion: input.info?.keyVersion ?? null,
          })),
        )
        .returning();
      return rows.map(toRecord);
    });
  }
}
