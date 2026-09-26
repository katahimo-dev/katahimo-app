import type { TenantSecretName } from '@katahimo/core/domain';

/**
 * 秘密値の暗号文に結び付ける追加認証データ(AES-GCM / Cloud KMS の additionalAuthenticatedData)。
 * テナントIDと秘密値の名前を含め、ある行の暗号文を別のテナント・別の名前の行に写しても開けないようにする。
 */
export function secretBinding(tenantId: string, name: TenantSecretName): Buffer {
  return Buffer.from(`katahimo/tenant-secret/v1\0${tenantId}\0${name}`, 'utf8');
}
