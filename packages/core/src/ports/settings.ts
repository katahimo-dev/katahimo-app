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
  valueEnc: Uint8Array;
  rotatedAt: Date;
}

export interface TenantSecretRepository {
  get(name: TenantSecretName): Promise<TenantSecretRecord | null>;
  put(name: TenantSecretName, valueEnc: Uint8Array, updatedBy: string | null): Promise<void>;
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
  /** 上書きを保存し、版を上げて履歴(ai_prompt_revisions)に残す。 */
  save(input: { key: string; kind: AiPromptKindValue; body: string; updatedBy: string }): Promise<void>;
  /** 上書きを消して既定値に戻す(履歴には body = null の版を残す)。 */
  reset(key: string, updatedBy: string): Promise<void>;
}
