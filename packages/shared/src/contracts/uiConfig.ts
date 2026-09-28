import { z } from 'zod';

const assessmentDefinitionSchema = z.object({
  title: z.string(),
  levels: z.array(z.object({ score: z.number().int(), label: z.string(), desc: z.string() })),
});

const educationLevelDefinitionSchema = z.object({
  title: z.string(),
  levels: z.array(
    z.object({ score: z.number().int(), label: z.string(), customerProfile: z.string(), usage: z.string() }),
  ),
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
  /**
   * 家庭の教育思考★の段階ごとの説明(★1〜5)。テナントの「日報AIの調整」の教育思考★(呼称・想定顧客像・教育語の使い方)が
   * あればその文言、無ければ EDUCATION_LEVEL_DEFINITIONS。
   */
  educationLevels: educationLevelDefinitionSchema,
});
export type UiConfigResponse = z.infer<typeof uiConfigResponseSchema>;
