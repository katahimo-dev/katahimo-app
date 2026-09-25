/**
 * テナントが上書きしたAIプロンプト・プレースホルダー(ai_promptsテーブル)のポート。
 * 行が無いkeyは @katahimo/shared の AI_PROMPT_DEFINITIONS の既定値を使う(判定はusecase側)。
 */
export type AiPromptKindValue = 'prompt' | 'placeholder';

export interface AiPromptRecord {
  tenantId: string;
  kind: AiPromptKindValue;
  key: string;
  body: string;
  updatedByStaffId: string | null;
  updatedAt: Date;
}

export interface UpsertAiPromptInput {
  tenantId: string;
  kind: AiPromptKindValue;
  key: string;
  body: string;
  updatedByStaffId: string;
}

export interface AiPromptRepositoryPort {
  listAll(tenantId: string): Promise<AiPromptRecord[]>;
  findByKey(tenantId: string, key: string): Promise<AiPromptRecord | null>;
  upsert(input: UpsertAiPromptInput): Promise<AiPromptRecord>;
  delete(tenantId: string, key: string): Promise<void>;
}
