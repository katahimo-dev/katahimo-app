/**
 * PSI(リスク)/従業員満足度(ES)評価の定義。GAS版Main.jsのASSESSMENT_DEFINITIONSをそのまま移植
 * (GAS版でもScript Properties等の管理画面設定ではなく、コード内の固定値として持っている)。
 */
export interface AssessmentLevel {
  score: number;
  label: string;
  desc: string;
}

export interface AssessmentDefinition {
  title: string;
  levels: AssessmentLevel[];
}

export type AssessmentType = 'risk' | 'es';

export const ASSESSMENT_DEFINITIONS: Record<AssessmentType, AssessmentDefinition> = {
  risk: {
    title: 'PSI',
    levels: [
      {
        score: 5,
        label: '安心・良好',
        desc: '全く懸念がない状態。\n保護者の表情も明るく、お子様も衛生・情緒ともに安定している。\n部屋も安全に保たれている。',
      },
      {
        score: 4,
        label: '通常',
        desc: '一般的な家庭の状態。\n多少の疲れや散らかりはあるが、保育に支障はなく、親子の関わりも標準的。',
      },
      {
        score: 3,
        label: '要観察',
        desc: '「少し気になる」レベル。\n保護者がひどく疲れている、部屋が不衛生になりつつある、子供の情緒が少し不安定など。\n※次回の担当者に引き継ぎたい内容がある。',
      },
      {
        score: 2,
        label: '注意',
        desc: '明らかに異変を感じる状態。\n保護者の反応が鈍い(無視・無表情)、子供の体や服が著しく汚れている、怒鳴り声が多いなど。\n※管理者への報告を強く推奨。',
      },
      {
        score: 1,
        label: '危険・緊急',
        desc: '緊急の介入が必要な状態。\n明らかな虐待の痕跡(あざ・傷)、育児放棄(ネグレクト)、保護者の心身耗弱が激しく子供の安全が守れない。\n※直ちに管理者に電話連絡が必要。',
      },
    ],
  },
  es: {
    title: '従業員満足度(ES)',
    levels: [
      {
        score: 5,
        label: '最高',
        desc: 'ぜひまた担当したい(優先希望)。\n顧客の態度が非常に良く、感謝されており、環境も快適。\n精神的にも報酬以上のやりがいを感じる。',
      },
      {
        score: 4,
        label: '良',
        desc: '問題なく担当できる。\n常識的な対応をしていただき、業務遂行にストレスがない。\n標準的な「良いお客様」。',
      },
      {
        score: 3,
        label: '可',
        desc: '担当しても良い(許容範囲)。\n多少のやりにくさ(細かい指示や部屋の環境など)はあるが、仕事として割り切れる範囲。',
      },
      {
        score: 2,
        label: '難あり',
        desc: 'できれば担当したくない(回避希望)。\n高圧的な態度、契約外の要求が多い、部屋が極端に不衛生などで、精神的・体力的に消耗が激しい。',
      },
      {
        score: 1,
        label: 'NG',
        desc: '二度と担当できない(ブラック)。\nハラスメント(暴言・セクハラ)、身の危険を感じる、著しい契約違反など。\n※担当を外れることを希望するレベル。',
      },
    ],
  },
};
