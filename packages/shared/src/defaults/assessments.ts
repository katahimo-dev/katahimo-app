/**
 * PSI(リスク)/従業員満足度(ES)評価の定義。GAS版Main.jsのASSESSMENT_DEFINITIONSを文言そのままで移植
 * (GAS版でも管理画面設定ではなくコード内の固定値。GET /api/ui-config でUIへ配る)。
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

export interface AssessmentDefinitions {
  risk: AssessmentDefinition;
  es: AssessmentDefinition;
}

export const ASSESSMENT_DEFINITIONS: AssessmentDefinitions = {
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
        desc: '明らかに異変を感じる状態。\n保護者の反応が鈍い（無視・無表情）、子供の体や服が著しく汚れている、怒鳴り声が多いなど。\n※管理者への報告を強く推奨。',
      },
      {
        score: 1,
        label: '危険・緊急',
        desc: '緊急の介入が必要な状態。\n明らかな虐待の痕跡（あざ・傷）、育児放棄（ネグレクト）、保護者の心身耗弱が激しく子供の安全が守れない。\n※直ちに管理者に電話連絡が必要。',
      },
    ],
  },
  es: {
    title: '従業員満足度(ES)',
    levels: [
      {
        score: 5,
        label: '最高',
        desc: 'ぜひまた担当したい（優先希望）。\n顧客の態度が非常に良く、感謝されており、環境も快適。\n精神的にも報酬以上のやりがいを感じる。',
      },
      {
        score: 4,
        label: '良',
        desc: '問題なく担当できる。\n常識的な対応をしていただき、業務遂行にストレスがない。\n標準的な「良いお客様」。',
      },
      {
        score: 3,
        label: '可',
        desc: '担当しても良い（許容範囲）。\n多少のやりにくさ（細かい指示や部屋の環境など）はあるが、仕事として割り切れる範囲。',
      },
      {
        score: 2,
        label: '難あり',
        desc: 'できれば担当したくない（回避希望）。\n高圧的な態度、契約外の要求が多い、部屋が極端に不衛生などで、精神的・体力的に消耗が激しい。',
      },
      {
        score: 1,
        label: 'NG',
        desc: '二度と担当できない（ブラック）。\nハラスメント（暴言・セクハラ）、身の危険を感じる、著しい契約違反など。\n※担当を外れることを希望するレベル。',
      },
    ],
  },
};

/** 家庭の教育思考★の1段階の説明(日報のダイアログ・お客様の情報の「❓ 説明」と★の下の一言)。 */
export interface EducationLevelDefinition {
  score: number;
  /** 呼称(例「標準」)。 */
  label: string;
  /** 想定顧客像。 */
  customerProfile: string;
  /** 教育語の使い方。 */
  usage: string;
}

/**
 * 教育思考★の既定の説明(お客様の日報キーワード表現マスター「03 教育思考レベル定義」の文言)。テナントが「日報AIの調整」の
 * 教育思考★を入れていれば、段階ごと・項目ごとにその文言にする(GET /api/ui-config)。
 */
export const EDUCATION_LEVEL_DEFINITIONS: { title: string; levels: EducationLevelDefinition[] } = {
  title: 'ご家庭の教育への関心（教育思考★）',
  levels: [
    {
      score: 1,
      label: '関心薄・安心最優先',
      customerProfile: '教育への関心は薄め。まず安心・安全を重視する家庭。',
      usage: '教育語は原則使わない。日常の様子＋温かい所感のみ。',
    },
    {
      score: 2,
      label: '標準',
      customerProfile: '一般的な家庭。日報はきちんと読む。',
      usage: '平易な自然語を1つまで（集中していた/楽しそう/自分から）。',
    },
    {
      score: 3,
      label: 'やや関心あり',
      customerProfile: '成長に関心。習い事を検討し始める層。',
      usage: '平易な教育概念を1語、意味づけとともに。',
    },
    {
      score: 4,
      label: '関心高い（先取り検討層）',
      customerProfile: '体験重視・慎重先取り。',
      usage: '教育語1〜2語をやさしい説明つきで。',
    },
    {
      score: 5,
      label: '非常に高い（モンテッソーリ等志向）',
      customerProfile: '教育投資に積極的。専門知識に関心。',
      usage: '専門用語を用語名＋説明つきで積極活用。',
    },
  ],
};
