import type { TenantSecretName } from '../domain/model';

/**
 * テナントの秘密値(tenant_secrets。Gemini の API キー・Google Chat の Webhook URL)の封と開封。
 * 実装は @katahimo/integrations の secret-box(本番は Cloud KMS の鍵で直接暗号化・復号、開発はローカルの鍵)。
 * 暗号文はテナントIDと秘密値の名前に結び付き、別のテナント・別の名前の行に写しても開けない。
 * 本番の開封は Cloud KMS を呼ぶため、Unit of Work のトランザクションの外で呼ぶ。
 */
export interface SecretBoxPort {
  seal(tenantId: string, name: TenantSecretName, plaintext: string): Promise<Uint8Array>;
  open(tenantId: string, name: TenantSecretName, sealed: Uint8Array): Promise<string>;
}
