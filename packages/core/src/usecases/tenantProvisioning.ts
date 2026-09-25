import { randomBytes } from 'node:crypto';
import { invalid, newId } from '../domain';
import type { BusinessType } from '../domain/model';
import type { KeyManagementPort } from '../ports/kms';
import type { TenantDirectoryPort, TenantProvisioningPort, TenantRecord } from '../ports/tenants';

export interface TenantProvisioningDeps {
  tenants: TenantDirectoryPort;
  provisioning: TenantProvisioningPort;
  kms: KeyManagementPort;
}

export interface ProvisionTenantRequest {
  slug: string;
  name: string;
  timezone?: string;
  businessType?: BusinessType;
}

/**
 * テナントを作る(運用の CLI・シード)。最初のデータ暗号化鍵(DEK)をここで作って KMS でラップし、
 * platform.provision_tenant() がテナント・鍵・設定をまとめて作る。DEK のラップの AAD にテナントIDを含めるため、
 * テナントIDはここで採番する。同じ slug が既にあればそのテナントを返す(何度流してもよい)。
 */
export async function provisionTenant(
  deps: TenantProvisioningDeps,
  request: ProvisionTenantRequest,
): Promise<{ tenant: TenantRecord; created: boolean }> {
  const slug = request.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw invalid('テナントの slug は英小文字・数字・ハイフン(2〜63文字)にしてください');
  }
  const existing = await deps.tenants.findBySlug(slug);
  if (existing) return { tenant: existing, created: false };
  const id = newId();
  const wrapped = await deps.kms.wrap(randomBytes(32), id);
  await deps.provisioning.provision({
    id,
    slug,
    name: request.name,
    timezone: request.timezone ?? 'Asia/Tokyo',
    businessType: request.businessType ?? 'babysitting',
    wrappedDek: wrapped.wrapped,
    kekKeyName: wrapped.kekKeyName,
  });
  const tenant = await deps.tenants.findById(id);
  if (!tenant) throw new Error(`作成したテナントを読めません(id=${id})`);
  return { tenant, created: true };
}
