import type { EncryptedField } from '@katahimo/core/ports';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import {
  type AttributeCategory,
  type AttributeValueType,
  attributeDefinitions,
  staffAttributes,
} from '../schema';

/**
 * スタッフ属性(特技・資格等)のカタログと、スタッフごとの保有属性の読み書き(doc/10)。
 * 将来のマッチングアプリ向けの土台。core側のPortはまだ無いため、型はこのファイルで定義する
 * (マッチングのユースケースを作る段階でcore/portsへ移す想定)。
 */
export interface AttributeDefinitionRecord {
  id: string;
  tenantId: string;
  category: AttributeCategory;
  key: string;
  label: string;
  valueType: AttributeValueType;
  maxLevel: number | null;
  sortOrder: number;
  archivedAt: Date | null;
}

export interface NewAttributeDefinitionInput {
  tenantId: string;
  category: AttributeCategory;
  key: string;
  label: string;
  valueType?: AttributeValueType;
  maxLevel?: number | null;
  sortOrder?: number;
}

export interface StaffAttributeRecord {
  id: string;
  tenantId: string;
  staffId: string;
  attributeDefinitionId: string;
  level: number | null;
  valueText: string | null;
  /** 'YYYY-MM-DD'。 */
  expiresOn: string | null;
  note: EncryptedField | null;
}

export interface UpsertStaffAttributeInput {
  tenantId: string;
  staffId: string;
  attributeDefinitionId: string;
  level?: number | null;
  valueText?: string | null;
  expiresOn?: string | null;
  note?: EncryptedField | null;
}

function toDefinitionRecord(row: typeof attributeDefinitions.$inferSelect): AttributeDefinitionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    category: row.category,
    key: row.key,
    label: row.label,
    valueType: row.valueType,
    maxLevel: row.maxLevel,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
  };
}

function toStaffAttributeRecord(row: typeof staffAttributes.$inferSelect): StaffAttributeRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    attributeDefinitionId: row.attributeDefinitionId,
    level: row.level,
    valueText: row.valueText,
    expiresOn: row.expiresOn,
    note:
      row.noteCiphertext && row.noteKeyVersion != null
        ? { ciphertext: row.noteCiphertext, keyVersion: row.noteKeyVersion }
        : null,
  };
}

export class DrizzleAttributeRepository {
  constructor(private readonly db: Database) {}

  /** 属性定義の一覧(sort_order順)。既定ではアーカイブ済みを除く。 */
  async listDefinitions(
    tenantId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<AttributeDefinitionRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(attributeDefinitions)
        .where(options.includeArchived ? undefined : isNull(attributeDefinitions.archivedAt))
        .orderBy(asc(attributeDefinitions.sortOrder), asc(attributeDefinitions.label));
      return rows.map(toDefinitionRecord);
    });
  }

  async createDefinition(input: NewAttributeDefinitionInput): Promise<AttributeDefinitionRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(attributeDefinitions)
        .values({
          tenantId: input.tenantId,
          category: input.category,
          key: input.key,
          label: input.label,
          valueType: input.valueType ?? 'boolean',
          maxLevel: input.maxLevel ?? null,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('属性定義の作成に失敗しました');
      return toDefinitionRecord(row);
    });
  }

  /** 物理削除せずアーカイブする(過去の割当理由から参照されうるため)。 */
  async archiveDefinition(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(attributeDefinitions)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(attributeDefinitions.id, id));
    });
  }

  /** 指定スタッフ群の保有属性をまとめて取得する(マッチングで候補スタッフ全員分を1クエリで読む用途)。 */
  async listStaffAttributes(tenantId: string, staffIds: string[]): Promise<StaffAttributeRecord[]> {
    if (staffIds.length === 0) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staffAttributes).where(inArray(staffAttributes.staffId, staffIds));
      return rows.map(toStaffAttributeRecord);
    });
  }

  async upsertStaffAttribute(input: UpsertStaffAttributeInput): Promise<StaffAttributeRecord> {
    const values = {
      level: input.level ?? null,
      valueText: input.valueText ?? null,
      expiresOn: input.expiresOn ?? null,
      noteCiphertext: input.note?.ciphertext ?? null,
      noteKeyVersion: input.note?.keyVersion ?? null,
    };
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(staffAttributes)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          attributeDefinitionId: input.attributeDefinitionId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [staffAttributes.tenantId, staffAttributes.staffId, staffAttributes.attributeDefinitionId],
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('スタッフ属性の保存に失敗しました');
      return toStaffAttributeRecord(row);
    });
  }

  async deleteStaffAttribute(
    tenantId: string,
    staffId: string,
    attributeDefinitionId: string,
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(staffAttributes)
        .where(
          and(
            eq(staffAttributes.staffId, staffId),
            eq(staffAttributes.attributeDefinitionId, attributeDefinitionId),
          ),
        );
    });
  }
}
