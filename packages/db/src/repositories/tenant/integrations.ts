import type {
  IntegrationApiKeyRecord,
  IntegrationApiKeyRepository,
  NewIntegrationApiKeyInput,
} from '@katahimo/core/ports';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { integrationApiKeys } from '../../schema';
import { TenantBound } from './base';

const keyColumns = {
  id: integrationApiKeys.id,
  name: integrationApiKeys.name,
  customerSource: integrationApiKeys.customerSource,
  createdBy: integrationApiKeys.createdBy,
  createdAt: integrationApiKeys.createdAt,
  lastUsedAt: integrationApiKeys.lastUsedAt,
  revokedAt: integrationApiKeys.revokedAt,
};

/**
 * 外部システム連携の API キー。発行・失効は所有者の接続(運用担当者の CLI)だけが書ける
 * (アプリのロールは SELECT と last_used_at の UPDATE だけ。0001_baseline_custom.sql)。
 */
export class DrizzleIntegrationApiKeyRepository extends TenantBound implements IntegrationApiKeyRepository {
  async create(input: NewIntegrationApiKeyInput): Promise<IntegrationApiKeyRecord> {
    const [row] = await this.tx
      .insert(integrationApiKeys)
      .values({ tenantId: this.tenantId, ...input })
      .returning(keyColumns);
    if (!row) throw new Error('API キーを作れませんでした');
    return row;
  }

  list(): Promise<IntegrationApiKeyRecord[]> {
    return this.tx
      .select(keyColumns)
      .from(integrationApiKeys)
      .where(eq(integrationApiKeys.tenantId, this.tenantId))
      .orderBy(desc(integrationApiKeys.createdAt), desc(integrationApiKeys.id));
  }

  async findByTokenHash(tokenHash: Uint8Array): Promise<IntegrationApiKeyRecord | null> {
    const rows = await this.tx
      .select(keyColumns)
      .from(integrationApiKeys)
      .where(
        and(eq(integrationApiKeys.tenantId, this.tenantId), eq(integrationApiKeys.tokenHash, tokenHash)),
      );
    return rows[0] ?? null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.tx
      .update(integrationApiKeys)
      .set({ lastUsedAt: at })
      .where(and(eq(integrationApiKeys.tenantId, this.tenantId), eq(integrationApiKeys.id, id)));
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(integrationApiKeys)
      .set({ revokedAt: at })
      .where(
        and(
          eq(integrationApiKeys.tenantId, this.tenantId),
          eq(integrationApiKeys.id, id),
          isNull(integrationApiKeys.revokedAt),
        ),
      )
      .returning({ id: integrationApiKeys.id });
    return rows.length > 0;
  }
}
