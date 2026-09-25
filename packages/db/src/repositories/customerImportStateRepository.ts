import type { CustomerImportState, CustomerImportStateRepositoryPort } from '@katahimo/core/ports';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { appSettings } from '../schema';

type AppSettingsRow = typeof appSettings.$inferSelect;

function toState(row: AppSettingsRow | undefined): CustomerImportState {
  return {
    lastImportedVersion: row?.customerCsvLastImportedVersion ?? null,
    lastImportedAt: row?.customerCsvLastImportedAt ?? null,
    dataVersion: row?.dataVersion ?? 0,
  };
}

/**
 * 顧客CSV取込の状態(app_settings の customer_csv_last_imported_version / _at / data_version)。
 * 管理者設定(Gemini・Webhook等)とは別の関心事のため、同じ行の取込状態の列だけを扱う専用リポジトリにしている。
 */
export class DrizzleCustomerImportStateRepository implements CustomerImportStateRepositoryPort {
  constructor(private readonly db: Database) {}

  async get(tenantId: string): Promise<CustomerImportState> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(appSettings).where(eq(appSettings.tenantId, tenantId)).limit(1);
      return toState(rows[0]);
    });
  }

  async recordImport(tenantId: string, version: string, importedAt: Date): Promise<CustomerImportState> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .insert(appSettings)
        .values({
          tenantId,
          customerCsvLastImportedVersion: version,
          customerCsvLastImportedAt: importedAt,
          dataVersion: 1,
        })
        .onConflictDoUpdate({
          target: appSettings.tenantId,
          set: {
            customerCsvLastImportedVersion: version,
            customerCsvLastImportedAt: importedAt,
            dataVersion: sql`${appSettings.dataVersion} + 1`,
            updatedAt: new Date(),
          },
        })
        .returning();
      return toState(rows[0]);
    });
  }
}
