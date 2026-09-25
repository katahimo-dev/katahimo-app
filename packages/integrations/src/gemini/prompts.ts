/**
 * GAS版GeminiReport.js DEFAULT_PROMPTS からそのまま移植したプロンプトテンプレート。
 * GAS版は「ＡＩプロンプト」シートで管理者が上書きできたが、そのための管理画面は
 * 本アプリにまだ無いため、当面はこの既定値のみを使う(将来的にprompts.tsをDB化する余地は
 * packages/db/src/schema/ の拡張として残しておく)。
 */

export const GENERATE_DAILY_REPORT_PROMPT = `
あなたは保育士の業務を支援するAIアシスタントです。
以下の「保育日報のメモ(口語)」をもとに、日報を作成してください。

# 必須情報チェック
以下の3点が入力テキストに含まれているか確認してください。
1. **訪問当日のサポート内容** (具体的に何をしたか)
2. **お客様情報** (家庭内の状況や家族との会話から見えた生活状況など)
3. **振り返り** (自分のサポートに対しての内省・今回どうだったか)

# 指示
- 不足している必須情報があれば、その項目名を "warnings" 配列にリストアップしてください(例: ["お客様情報", "振り返り"])。
- 不足情報の有無に関わらず、入力された情報を元に可能な範囲でレポートを作成してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力フォーマット (JSON)
{
  "warnings": ["不足項目名1", "不足項目名2"], // なければ空配列 []
  "internal": "社内向けレポート内容(事実・客観的)。読みやすさのため、適宜改行コード(\\n)を含めてください。",
  "customer": "保護者向けレポート内容(親しみやすく)。読みやすさのため、適宜改行コード(\\n)を含めてください。"
}
`;

export const GENERATE_ACCIDENT_REPORT_PROMPT = `
あなたは保育園の事故報告書作成を支援するAIです。
入力された状況説明(メモ)から、以下の項目に整理・分解してJSON形式で出力してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力項目とルール
- occurrenceTime: 発生日時(令和〇年〇月〇日...の形式が望ましいが、入力から推測できる範囲で。不明なら「要確認」としてください)
- location: 発生場所(施設名+部屋名、屋外ならエリアなど)
- accidentContent: 事故内容(端的な見出し。例:転倒による額切創)
- situation: 発生状況(5W1H、時系列。推測は避け事実のみ)
- immediateResponse: 発生時の対応(誰が、何分後に、何をしたか。タイムライン形式など)
- parentCorrespondence: 保護者への対応(連絡手段、時刻、反応、受診予定など)
- diagnosisTreatment: 診断名および処置状況/必要診察日数(未受診なら「診療前」と明記)
- prevention: 事故防止に向けた今後の対応(原因分析、一次対策、恒久対策)

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
