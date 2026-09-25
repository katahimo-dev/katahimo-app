/**
 * 管理者が編集できるAIプロンプト・入力欄プレースホルダーの定義と既定値(ai_promptsテーブルの
 * key/kindに対応)。GAS版GeminiReport.jsのPROMPT_KEYS/DEFAULT_PROMPTS(「ＡＩプロンプト」シート)を
 * 文言そのままで移植したもの。テナントがai_promptsに行を持たないkeyは、ここの既定値を使う。
 *
 * プロンプト本文は {anonymizedText}(入力メモ)と {timeInfo}(時間情報)を差し込み位置として含む。
 */

export type AiPromptKind = 'prompt' | 'placeholder';

export const AI_PROMPT_KEYS = {
  DAILY_REPORT_GENERATE: 'daily_report.generate',
  ACCIDENT_REPORT_GENERATE: 'accident_report.generate',
  DAILY_MEMO_PLACEHOLDER: 'daily_report.memo_placeholder',
  ACCIDENT_MEMO_PLACEHOLDER: 'accident_report.memo_placeholder',
  ACCIDENT_WRITING_HINT: 'accident_report.writing_hint',
  HIYARI_WRITING_HINT: 'hiyari.writing_hint',
} as const;

export type AiPromptKey = (typeof AI_PROMPT_KEYS)[keyof typeof AI_PROMPT_KEYS];

export interface AiPromptDefinition {
  key: AiPromptKey;
  kind: AiPromptKind;
  /** 管理画面での表示名。 */
  label: string;
  /** GAS版「ＡＩプロンプト」シートのKey列の値(シートからの移行時の対応付け用)。 */
  legacySheetKey: string;
  defaultBody: string;
}

const DEFAULT_DAILY_REPORT_GENERATE = `
あなたは保育士の業務を支援するAIアシスタントです。
以下の「保育日報のメモ（口語）」をもとに、日報を作成してください。

# 必須情報チェック
以下の3点が入力テキストに含まれているか確認してください。
1. **訪問当日のサポート内容** (具体的に何をしたか)
2. **お客様情報** (家庭内の状況や家族との会話から見えた生活状況など)
3. **振り返り** (自分のサポートに対しての内省・今回どうだったか)

# 指示
- 不足している必須情報があれば、その項目名を "warnings" 配列にリストアップしてください（例: ["お客様情報", "振り返り"]）。
- 不足情報の有無に関わらず、入力された情報を元に可能な範囲でレポートを作成してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力フォーマット (JSON)
{
  "warnings": ["不足項目名1", "不足項目名2"], // なければ空配列 []
  "internal": "社内向けレポート内容（事実・客観的）。読みやすさのため、適宜改行コード(\\n)を含めてください。",
  "customer": "保護者向けレポート内容（親しみやすく）。読みやすさのため、適宜改行コード(\\n)を含めてください。"
}
`;

const DEFAULT_ACCIDENT_REPORT_GENERATE = `
あなたは保育園の事故報告書作成を支援するAIです。
入力された状況説明（メモ）から、以下の項目に整理・分解してJSON形式で出力してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力項目とルール
- occurrenceTime: 発生日時（令和〇年〇月〇日...の形式が望ましいが、入力から推測できる範囲で。不明なら「要確認」としてください）
- location: 発生場所（施設名＋部屋名、屋外ならエリアなど）
- accidentContent: 事故内容（端的な見出し。例：転倒による額切創）
- situation: 発生状況（5W1H、時系列。推測は避け事実のみ）
- immediateResponse: 発生時の対応（誰が、何分後に、何をしたか。タイムライン形式など）
- parentCorrespondence: 保護者への対応（連絡手段、時刻、反応、受診予定など）
- diagnosisTreatment: 診断名および処置状況/必要診察日数（未受診なら「診療前」と明記）
- prevention: 事故防止に向けた今後の対応（原因分析、一次対策、恒久対策）

# 出力フォーマット (JSON)
{
  "occurrenceTime": "...",
  "location": "...",
  "accidentContent": "...",
  "situation": "...",
  "immediateResponse": "...",
  "parentCorrespondence": "...",
  "diagnosisTreatment": "...",
  "prevention": "..."
}
`;

const DEFAULT_DAILY_MEMO_PLACEHOLDER = `①訪問当日のサポート内容
   　（実際に実施した保育・家事・対応内容など）
② お客様情報
   　（家庭内の状況、保護者や子どもの様子、会話から見えた生活状況・要望・健康面など）
③　振り返り
   　（支援中の状況→対応→結果、気づき、改善点、次回への申し送りなど）`;

const DEFAULT_ACCIDENT_MEMO_PLACEHOLDER = `①事実を時系列で、客観的に
感情的な表現や推測は避け、見聞きした事実のみを時系列に並べます。

②「5W1H＋初動対応」を意識
いつ・どこで・誰が・何をしていて・何が起こり・どう対処したかを必ず押さえます。

③ヒヤリハットも記録
ヒヤリハットも重大事故と同じ視点で記録し、要因分析と再発防止策を残すことで重大事故を防げます`;

const DEFAULT_ACCIDENT_WRITING_HINT = `事故報告書 記載項目と記載要領

発生日時
「令和〇年〇月〇日（曜）午後〇時〇分頃」の形で、分単位まで記載。発見時刻と発生時刻が異なる場合は両方書く。

発生場所
施設名＋部屋名／屋外の場合はエリアまで具体的に
（例：〇〇公園すべり台下）。

事故内容
端的な見出し語で
「転倒による額切創」「アレルギー症状（じんましん）」など
原因＋結果をセットで。

発生状況
①環境 ②子どもの行動 ③職員配置 ④事故発生の瞬間
の順に、1文1事実で記録。観察できない部分は書かない。

発生時の対応
①誰が ②何分後に ③何をしたのかをタイムライン形式で。
「14:05 冷水で5分間冷却 → 14:10 止血確認 → 14:12 保護者へ電話」など。

保護者への対応
連絡手段・時刻・先方の反応・今後の受診予定を簡潔に。
「14:12 母・携帯へ連絡、15:00 来園し受診同意」

診断名および処置状況／必要診察日数
受診後に医師の診断名を正式に転記。
未受診の段階では「診察前」と明記し暫定措置を書く。

事故防止に向けた今後の対応
①原因分析（環境・人・手順の観点で）
→②一次対策（急ぎの安全策）
→③恒久対策（マニュアル改訂・研修など）
を箇条書きで。`;

const DEFAULT_HIYARI_WRITING_HINT = `■ヒヤリハットを記入するときの追加留意点
①「もし○○していたら重大事故」まで想定して原因を書く
例：「高さ60 cmの踏み台から足を滑らせたが、すぐ横に職員がいて転落を回避」
②再発防止策を必ず具体化（配置変更、備品購入、声かけ方法など）

■よくあるNG集

NG例	修正方法
主観的表現 「急に暴れ出した」	行動を具体的に「立ち上がって走り出した」
「たぶん眠かった」	憶測を削除 or 根拠を追記「午睡前で目をこすっていたため眠気があった可能性」
時刻抜け・曖昧な順序	タイムラインで整理し、時計を確認して都度メモ。
再発防止策が抽象的 「注意する」	「○月○日までに踏み台に滑り止めテープを貼付、写真を共有」など行動・期限・担当を明示。`;

export const AI_PROMPT_DEFINITIONS: readonly AiPromptDefinition[] = [
  {
    key: AI_PROMPT_KEYS.DAILY_REPORT_GENERATE,
    kind: 'prompt',
    label: '保育日報のAI生成プロンプト',
    legacySheetKey: 'GenerateWithWarnings',
    defaultBody: DEFAULT_DAILY_REPORT_GENERATE,
  },
  {
    key: AI_PROMPT_KEYS.ACCIDENT_REPORT_GENERATE,
    kind: 'prompt',
    label: '事故報告/ヒヤリハットのAI生成プロンプト',
    legacySheetKey: 'GenerateAccident',
    defaultBody: DEFAULT_ACCIDENT_REPORT_GENERATE,
  },
  {
    key: AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER,
    kind: 'placeholder',
    label: '日報メモ欄のプレースホルダー',
    legacySheetKey: 'PlaceholderDaily',
    defaultBody: DEFAULT_DAILY_MEMO_PLACEHOLDER,
  },
  {
    key: AI_PROMPT_KEYS.ACCIDENT_MEMO_PLACEHOLDER,
    kind: 'placeholder',
    label: '事故報告メモ欄のプレースホルダー',
    legacySheetKey: 'PlaceholderAccident',
    defaultBody: DEFAULT_ACCIDENT_MEMO_PLACEHOLDER,
  },
  {
    key: AI_PROMPT_KEYS.ACCIDENT_WRITING_HINT,
    kind: 'placeholder',
    label: '事故報告の書き方ヒント',
    legacySheetKey: 'HintAccident',
    defaultBody: DEFAULT_ACCIDENT_WRITING_HINT,
  },
  {
    key: AI_PROMPT_KEYS.HIYARI_WRITING_HINT,
    kind: 'placeholder',
    label: 'ヒヤリハットの書き方ヒント',
    legacySheetKey: 'PlaceholderHiyari',
    defaultBody: DEFAULT_HIYARI_WRITING_HINT,
  },
];

export function findAiPromptDefinition(key: string): AiPromptDefinition | undefined {
  return AI_PROMPT_DEFINITIONS.find((d) => d.key === key);
}
