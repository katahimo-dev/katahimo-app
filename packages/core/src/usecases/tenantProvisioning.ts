import { randomBytes } from 'node:crypto';
import { checkPasswordPolicy, PASSWORD_POLICY_MESSAGES } from '@katahimo/shared';
import { invalid, newId, normalizeEmailForIndex } from '../domain';
import type { BusinessType, StaffRole } from '../domain/model';
import type { AppLogPort } from '../ports/appLog';
import type { KeyManagementPort } from '../ports/kms';
import type { TenantDirectoryPort, TenantProvisioningPort, TenantRecord } from '../ports/tenants';
import type { StaffRegistrationDeps } from './auth/deps';
import { registerStaff } from './auth/staffRegistration';

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

export interface TenantBootstrapDeps extends TenantProvisioningDeps, StaffRegistrationDeps {
  appLog: AppLogPort;
}

export interface BootstrapTenantRequest extends ProvisionTenantRequest {
  admin: {
    email: string;
    name: string;
    /** 省略時はパスワード未設定で作る(本人がログイン画面の「パスワードを忘れた方」から設定する)。 */
    initialPassword?: string;
  };
}

export interface BootstrapTenantResult {
  tenant: TenantRecord;
  tenantCreated: boolean;
  admin: { staffId: string; created: boolean; role: StaffRole };
}

/**
 * 本番のテナントと最初の管理者を作る(運用の CLI `tenant:create`)。何度流してもよい: テナントは slug で、
 * 管理者はログインメールで既存を探し、あればそのまま返す(既存のスタッフの権限・パスワードは変えない)。
 * 作ったものは SECURITY の操作ログに残す(操作者は system)。
 */
export async function bootstrapTenant(
  deps: TenantBootstrapDeps,
  request: BootstrapTenantRequest,
): Promise<BootstrapTenantResult> {
  const email = normalizeEmailForIndex(request.admin.email);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw invalid('管理者のメールアドレスが正しくありません');
  const adminName = request.admin.name.trim();
  if (!adminName) throw invalid('管理者の氏名を入れてください');
  const password = request.admin.initialPassword;
  if (password !== undefined) {
    const violation = checkPasswordPolicy(password);
    if (violation) throw invalid(PASSWORD_POLICY_MESSAGES[violation]);
  }

  const { tenant, created: tenantCreated } = await provisionTenant(deps, request);
  if (tenantCreated) {
    await deps.appLog.write({
      tenantId: tenant.id,
      level: 'SECURITY',
      action: 'tenant.provisioned',
      actorType: 'system',
      details: { slug: tenant.slug },
    });
  }

  const existing = await deps.uow.run(tenant.id, (r) => r.staff.findByLoginEmail(email));
  if (existing) {
    return { tenant, tenantCreated, admin: { staffId: existing.id, created: false, role: existing.role } };
  }
  const admin = await registerStaff(deps, {
    tenantId: tenant.id,
    name: adminName,
    email,
    role: 'admin',
    ...(password !== undefined ? { password } : {}),
  });
  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'SECURITY',
    action: 'staff.admin.bootstrapped',
    actorType: 'system',
    targetStaffId: admin.id,
    details: { passwordSet: password !== undefined },
  });
  return { tenant, tenantCreated, admin: { staffId: admin.id, created: true, role: admin.role } };
}
