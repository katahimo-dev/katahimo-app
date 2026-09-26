import type { AiPromptKey, AssessmentDefinitions } from '@katahimo/shared';
import {
  AI_PROMPT_DEFINITIONS,
  AI_PROMPT_KEYS,
  ASSESSMENT_DEFINITIONS,
  findAiPromptDefinition,
} from '@katahimo/shared';
import type { AppLogPort } from '../ports/appLog';
import type { AiPromptRecord } from '../ports/settings';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { RequestMeta } from './requestMeta';

export interface AiPromptDeps {
  uow: UnitOfWorkPort;
}

export interface UiConfigView {
  dailyPlaceholder: string;
  accidentPlaceholder: string;
  accidentHint: string;
  hiyariPlaceholder: string;
  assessments: AssessmentDefinitions;
}

/**
 * 日報/事故報告画面の文言・評価定義。GAS版Main.js getUiConfigに対応。PSI の定義・判定基準は、テナントが
 * 「日報AIの調整」の PSI(日報キーワード表現マスターのシート04)を入れていればその文言にする(段階ごと)。
 */
export async function getUiConfig(deps: AiPromptDeps, tenantId: string): Promise<UiConfigView> {
  const { prompts, psiLevels } = await deps.uow.run(tenantId, async (r) => ({
    prompts: await r.aiPrompts.listAll(),
    psiLevels: (await r.reportAi.loadActive()).psiLevels,
  }));
  const overrides = new Map(prompts.map((p) => [p.key, p.body]));
  const risk = {
    ...ASSESSMENT_DEFINITIONS.risk,
    levels: ASSESSMENT_DEFINITIONS.risk.levels.map((level) => {
      const tenantLevel = psiLevels.find((p) => p.level === level.score);
      return tenantLevel
        ? { score: level.score, label: tenantLevel.label, desc: tenantLevel.criteria ?? level.desc }
        : level;
    }),
  };
  const body = (key: AiPromptKey) => overrides.get(key) || findAiPromptDefinition(key)?.defaultBody || '';
  return {
    dailyPlaceholder: body(AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER),
    accidentPlaceholder: body(AI_PROMPT_KEYS.ACCIDENT_MEMO_PLACEHOLDER),
    accidentHint: body(AI_PROMPT_KEYS.ACCIDENT_WRITING_HINT),
    hiyariPlaceholder: body(AI_PROMPT_KEYS.HIYARI_WRITING_HINT),
    assessments: { risk, es: ASSESSMENT_DEFINITIONS.es },
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
  /** 最新の版(保存したことが無ければ 0)。更新のときに渡すと、他の管理者の保存との競合を検出する。 */
  revision: number;
}

function toView(
  definition: (typeof AI_PROMPT_DEFINITIONS)[number],
  row: AiPromptRecord | undefined,
  revision: number,
): AiPromptView {
  return {
    key: definition.key,
    kind: definition.kind,
    label: definition.label,
    body: row?.body || definition.defaultBody,
    defaultBody: definition.defaultBody,
    customized: Boolean(row?.body),
    updatedAt: row ? row.updatedAt.toISOString() : null,
    revision,
  };
}

/** 管理画面「AIプロンプト」の一覧(既定値の定義順)。 */
export async function listAiPromptsForAdmin(deps: AiPromptDeps, tenantId: string): Promise<AiPromptView[]> {
  const { rows, revisions } = await deps.uow.run(tenantId, async (r) => ({
    rows: new Map((await r.aiPrompts.listAll()).map((p) => [p.key, p])),
    revisions: await r.aiPrompts.latestRevisions(),
  }));
  return AI_PROMPT_DEFINITIONS.map((d) => toView(d, rows.get(d.key), revisions.get(d.key) ?? 0));
}

export interface UpdateAiPromptsInput {
  tenantId: string;
  staffId: string;
  /**
   * bodyがnull/空文字なら上書きを削除して既定値に戻す。revision(一覧で読んだ版)を渡すと、その後に他の管理者が
   * 保存していれば全体を conflict にする。
   */
  prompts: { key: string; body: string | null; revision?: number | undefined }[];
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
  try {
    await deps.uow.run(
      input.tenantId,
      async (r) => {
        const current = new Map((await r.aiPrompts.listAll()).map((p) => [p.key, p.body]));
        for (const p of input.prompts) {
          const definition = findAiPromptDefinition(p.key);
          if (!definition) continue;
          const body = p.body?.trim() ? p.body : '';
          if (!body || body === definition.defaultBody) {
            if (current.has(p.key)) {
              await r.aiPrompts.reset(p.key, input.staffId, p.revision);
              reset.push(p.key);
            }
          } else if (current.get(p.key) !== body) {
            await r.aiPrompts.save({
              key: p.key,
              kind: definition.kind,
              body,
              updatedBy: input.staffId,
              expectedRevision: p.revision,
            });
            updated.push(p.key);
          }
        }
      },
      { actorId: input.staffId },
    );
  } catch (error) {
    const reason = (error as { reason?: string }).reason;
    if (reason) {
      await deps.appLog.write({
        tenantId: input.tenantId,
        level: 'WARN',
        action: 'settings.ai_prompts.update_rejected',
        actorStaffId: input.staffId,
        details: { reason },
        ...input.meta,
      });
    }
    throw error;
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
