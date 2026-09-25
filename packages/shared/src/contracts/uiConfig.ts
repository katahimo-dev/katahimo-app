import { z } from 'zod';

const assessmentDefinitionSchema = z.object({
  title: z.string(),
  levels: z.array(z.object({ score: z.number().int(), label: z.string(), desc: z.string() })),
});

/**
 * GET /api/ui-config (要ログイン)。GAS版Main.js getUiConfigと同じ項目名。
 * 各文言はテナントのai_prompts(kind=placeholder)があればその値、無ければ既定値。
 */
export const uiConfigResponseSchema = z.object({
  dailyPlaceholder: z.string(),
  accidentPlaceholder: z.string(),
  accidentHint: z.string(),
  hiyariPlaceholder: z.string(),
  assessments: z.object({ risk: assessmentDefinitionSchema, es: assessmentDefinitionSchema }),
});
export type UiConfigResponse = z.infer<typeof uiConfigResponseSchema>;
