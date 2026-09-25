import type { AiPromptKey, AssessmentDefinitions } from '@katahimo/shared';
import {
  AI_PROMPT_DEFINITIONS,
  AI_PROMPT_KEYS,
  ASSESSMENT_DEFINITIONS,
  findAiPromptDefinition,
} from '@katahimo/shared';
import type { AiPromptRecord, AiPromptRepositoryPort } from '../ports/aiPrompts';
import type { AppLogPort } from '../ports/appLog';
import type { RequestMeta } from './requestMeta';

export interface AiPromptDeps {
  aiPrompts: AiPromptRepositoryPort;
}

/**
 * テナントの上書きがあればその本文、無ければ既定値を返す。GAS版GeminiReport.js getPromptに対応
 * (GAS版は行が無いと既定値をシートへ書き足していたが、本アプリは既定値をコード側に持つため書き込まない)。
 */
export async function resolvePromptBody(
  deps: AiPromptDeps,
  tenantId: string,
  key: AiPromptKey,
): Promise<string> {
  const row = await deps.aiPrompts.findByKey(tenantId, key);
  if (row?.body) return row.body;
  return findAiPromptDefinition(key)?.defaultBody ?? '';
}

export interface UiConfigView {
  dailyPlaceholder: string;
  accidentPlaceholder: string;
  accidentHint: string;
  hiyariPlaceholder: string;
  assessments: AssessmentDefinitions;
}

/** 日報/事故報告画面の文言・評価定義。GAS版Main.js getUiConfigに対応。 */
export async function getUiConfig(deps: AiPromptDeps, tenantId: string): Promise<UiConfigView> {
  const overrides = new Map((await deps.aiPrompts.listAll(tenantId)).map((r) => [r.key, r.body]));
  const body = (key: AiPromptKey) => overrides.get(key) || findAiPromptDefinition(key)?.defaultBody || '';
  return {
    dailyPlaceholder: body(AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER),
    accidentPlaceholder: body(AI_PROMPT_KEYS.ACCIDENT_MEMO_PLACEHOLDER),
    accidentHint: body(AI_PROMPT_KEYS.ACCIDENT_WRITING_HINT),
    hiyariPlaceholder: body(AI_PROMPT_KEYS.HIYARI_WRITING_HINT),
    assessments: ASSESSMENT_DEFINITIONS,
  };
}

export interface AiPromptView {
  key: string;
  kind: 'prompt' | 'placeholder';
  label: string;
  body: string;
  defaultBody: string;
  customized: boolean;
  updatedAt: string | null;
}

function toView(
  definition: (typeof AI_PROMPT_DEFINITIONS)[number],
  row: AiPromptRecord | undefined,
): AiPromptView {
  return {
    key: definition.key,
    kind: definition.kind,
    label: definition.label,
    body: row?.body || definition.defaultBody,
    defaultBody: definition.defaultBody,
    customized: Boolean(row?.body),
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

/** 管理画面「AIプロンプト」の一覧(既定値の定義順)。 */
export async function listAiPromptsForAdmin(deps: AiPromptDeps, tenantId: string): Promise<AiPromptView[]> {
  const rows = new Map((await deps.aiPrompts.listAll(tenantId)).map((r) => [r.key, r]));
  return AI_PROMPT_DEFINITIONS.map((d) => toView(d, rows.get(d.key)));
}

export interface UpdateAiPromptsInput {
  tenantId: string;
  staffId: string;
  /** bodyがnull/空文字なら上書きを削除して既定値に戻す。 */
  prompts: { key: string; body: string | null }[];
  meta?: RequestMeta;
}

export type UpdateAiPromptsResult =
  | { ok: true; prompts: AiPromptView[] }
  | { ok: false; reason: 'unknown_key'; keys: string[] };

/** 管理者によるプロンプト/プレースホルダーの更新。未知のkeyが1つでもあれば何も変更しない。 */
export async function updateAiPrompts(
  deps: AiPromptDeps & { appLog: AppLogPort },
  input: UpdateAiPromptsInput,
): Promise<UpdateAiPromptsResult> {
  const unknown = input.prompts.filter((p) => !findAiPromptDefinition(p.key)).map((p) => p.key);
  if (unknown.length > 0) return { ok: false, reason: 'unknown_key', keys: unknown };

  const updated: string[] = [];
  const reset: string[] = [];
  for (const p of input.prompts) {
    const definition = findAiPromptDefinition(p.key);
    if (!definition) continue;
    const body = p.body?.trim() ? p.body : '';
    if (!body || body === definition.defaultBody) {
      await deps.aiPrompts.delete(input.tenantId, p.key);
      reset.push(p.key);
    } else {
      await deps.aiPrompts.upsert({
        tenantId: input.tenantId,
        kind: definition.kind,
        key: p.key,
        body,
        updatedByStaffId: input.staffId,
      });
      updated.push(p.key);
    }
  }
  await deps.appLog.write({
    tenantId: input.tenantId,
    level: 'INFO',
    action: 'settings.ai_prompts.updated',
    actorStaffId: input.staffId,
    details: { updated, reset },
    ...input.meta,
  });
  return { ok: true, prompts: await listAiPromptsForAdmin(deps, input.tenantId) };
}
