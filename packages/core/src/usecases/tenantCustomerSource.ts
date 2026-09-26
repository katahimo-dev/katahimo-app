import { tenantCustomerImportSettingsSchema } from '@katahimo/shared';
import { invalid } from '../domain';
import type { TenantCustomerImportSettings } from '../domain/customerCsv/importSettings';
import type { AppLogPort } from '../ports/appLog';
import type { TenantCustomerImportSettingsStore, TenantDirectoryPort } from '../ports/tenants';

export interface TenantCustomerSourceDeps {
  tenants: TenantDirectoryPort;
  customerImportSettings: TenantCustomerImportSettingsStore;
  appLog: AppLogPort;
}

/** 運用担当者の変更(CLI の引数そのまま)。何も指定しなければ今の設定を返すだけ。 */
export type TenantCustomerSourceChange =
  | { kind: 'show' }
  /** RESERVA の顧客CSVを置く Google Drive のフォルダ(フォルダの URL の /folders/ の後ろ)。 */
  | { kind: 'drive_folder'; driveFolderId: string }
  /** 設定を消す(夜間の顧客CSV取込の対象から外す)。 */
  | { kind: 'clear' };

/**
 * テナントの顧客データの取込元を読む・変える(運用担当者の `pnpm tenant:customer-source`。テナントの管理者は
 * 変えられない: 取込元のフォルダはプラットフォームのサービスアカウントで読むため、テナントの管理者が好きなフォルダを
 * 指定できると別のテナントの顧客CSVを取り込めてしまう。calendar_settings と同じ考え方)。
 * 変えたら SECURITY `tenant.customer_import_settings.updated` を残す(フォルダID は残さず、設定の有無と種類だけ)。
 */
export async function updateTenantCustomerImportSettings(
  deps: TenantCustomerSourceDeps,
  tenantSlug: string,
  change: TenantCustomerSourceChange,
): Promise<{ tenantId: string; settings: TenantCustomerImportSettings | null }> {
  const tenant = await deps.tenants.findBySlug(tenantSlug.trim().toLowerCase());
  if (!tenant) throw invalid(`テナントが見つかりません: ${tenantSlug}`, undefined, 'tenant_not_found');
  if (change.kind === 'show') {
    return { tenantId: tenant.id, settings: await deps.customerImportSettings.get(tenant.id) };
  }
  let settings: TenantCustomerImportSettings | null = null;
  if (change.kind === 'drive_folder') {
    const parsed = tenantCustomerImportSettingsSchema.safeParse({
      provider: 'reserva_csv',
      driveFolderId: change.driveFolderId,
    });
    if (!parsed.success) {
      throw invalid(
        parsed.error.issues[0]?.message ?? 'フォルダIDが正しくありません',
        undefined,
        'invalid_folder',
      );
    }
    settings = parsed.data;
  }
  await deps.customerImportSettings.set(tenant.id, settings);
  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'SECURITY',
    action: 'tenant.customer_import_settings.updated',
    actorType: 'operator',
    details: { configured: settings !== null, provider: settings?.provider ?? null },
  });
  return { tenantId: tenant.id, settings };
}
