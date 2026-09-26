import type { CustomerSource } from '../domain/model';

/** 外部システム連携の API キー(integration_api_keys。トークンそのものは持たない)。 */
export interface IntegrationApiKeyRecord {
  id: string;
  name: string;
  /** このキーで書ける顧客の取込元(customer_source_records.source)。 */
  customerSource: CustomerSource;
  createdBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface NewIntegrationApiKeyInput {
  id: string;
  name: string;
  customerSource: CustomerSource;
  tokenHash: Uint8Array;
  createdBy: string;
}

export interface IntegrationApiKeyRepository {
  /** 発行(運用担当者の CLI。所有者の接続の UoW だけが書ける)。 */
  create(input: NewIntegrationApiKeyInput): Promise<IntegrationApiKeyRecord>;
  /** 失効を含む全てのキー(発行の新しい順)。 */
  list(): Promise<IntegrationApiKeyRecord[]>;
  findByTokenHash(tokenHash: Uint8Array): Promise<IntegrationApiKeyRecord | null>;
  /** 最後に使った時刻を記録する(API の認証のたび)。 */
  touch(id: string, at: Date): Promise<void>;
  /** 失効させる。まだ失効していないキーがあれば true。 */
  revoke(id: string, at: Date): Promise<boolean>;
}
