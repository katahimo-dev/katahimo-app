import { type TenantCustomerImportSettings, tenantCustomerImportSettingsSchema } from '@katahimo/shared';

export type { TenantCustomerImportSettings } from '@katahimo/shared';

/**
 * platform.tenants.customer_import_settings(jsonb)を読む。設定の無いテナント(`{}`)と、形の崩れた値は null
 * (自動取込の対象外。書くのは運用担当者の CLI だけで、書く前に同じスキーマで確かめる)。
 */
export function parseTenantCustomerImportSettings(raw: unknown): TenantCustomerImportSettings | null {
  const parsed = tenantCustomerImportSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
