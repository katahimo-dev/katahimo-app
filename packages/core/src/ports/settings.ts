import type { TenantSecretName } from '../domain/model';

export type AiPromptKindValue = 'prompt' | 'placeholder';

export interface TenantSettingsRecord {
  geminiReportModel: string | null;
  geminiOcrModel: string | null;
  careRecordRetentionDays: number;
  customerDataVersion: number;
}

export interface TenantSettingsRepository {
  get(): Promise<TenantSettingsRecord>;
  update(patch: Partial<Pick<TenantSettingsRecord, 'geminiReportModel' | 'geminiOcrModel'>>): Promise<void>;
  /** 顧客データの版数を1上げ、上げた後の値を返す。 */
  bumpCustomerDataVersion(): Promise<number>;
}

export interface TenantSecretRecord {
  name: TenantSecretName;
  /** SecretBoxPort.seal の暗号文。 */
  sealedValue: Uint8Array;
  rotatedAt: Date;
}

export interface TenantSecretRepository {
  get(name: TenantSecretName): Promise<TenantSecretRecord | null>;
  put(name: TenantSecretName, sealedValue: Uint8Array, updatedBy: string | null): Promise<void>;
}

export interface AiPromptRecord {
  key: string;
  kind: AiPromptKindValue;
  body: string;
  revision: number;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface AiPromptRepository {
  listAll(): Promise<AiPromptRecord[]>;
  findByKey(key: string): Promise<AiPromptRecord | null>;
  /**
   * キーごとの最新の版(履歴 ai_prompt_revisions の最大値。既定値に戻した後も続く。保存したことの無いキーは無い)。
   */
  latestRevisions(): Promise<Map<string, number>>;
  /**
   * 上書きを保存し、版を上げて履歴(ai_prompt_revisions)に残す。expectedRevision を渡すと、最新の版が違えば
   * (他の管理者が先に保存した)conflict。
   */
  save(input: {
    key: string;
    kind: AiPromptKindValue;
    body: string;
    updatedBy: string;
    expectedRevision?: number | undefined;
  }): Promise<void>;
  /** 上書きを消して既定値に戻す(履歴には body = null の版を残す)。expectedRevision は save と同じ。 */
  reset(key: string, updatedBy: string, expectedRevision?: number): Promise<void>;
}
