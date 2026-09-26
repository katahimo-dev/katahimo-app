/**
 * 管理者が編集できるAIプロンプト・入力欄プレースホルダーの定義と既定値(ai_promptsテーブルの
 * key/kindに対応)。GAS版GeminiReport.jsのPROMPT_KEYS/DEFAULT_PROMPTS(「ＡＩプロンプト」シート)を
 * 文言そのままで移植したもの。テナントがai_promptsに行を持たないkeyは、ここの既定値を使う。
 *
 * プロンプト本文は {anonymizedText}(入力メモ)と {timeInfo}(時間情報)を差し込み位置として含む。保育日報は加えて
 * 日報AIの3軸(年齢帯 × 教育思考★ × PSI)の差し込み({childAge} {eduLevel} {psi} {keywordTable} 等。
 * REPORT_PROMPT_PLACEHOLDERS)と、キーワード表があるときだけ残す行の範囲({#keywords} 〜 {/keywords})を持つ。
 * 差し込みは1回の走査で全ての箇所を置き換える(GAS版の String.replace は最初の1箇所だけだった)。
 */

export type AiPromptKind = 'prompt' | 'placeholder';

export const AI_PROMPT_KEYS = {
  DAILY_REPORT_GENERATE: 'daily_report.generate',
  /** 保育日報のプロンプトの {companyPolicy}(会社名・社是など法人ごとの1〜2文。既定は空 = 行ごと消える)。 */
  DAILY_REPORT_COMPANY_POLICY: 'daily_report.company_policy',
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

/**
 * 保育日報の生成プロンプトの既定値。お客様の「プロンプト変更案」(現行プロンプト → 日報キーワードを保護者向けに
 * 組み込む変更案)の全文を文言そのままで使う。ただし次の点だけを差し込みにしている。
 * - 会社名と社是の1文(法人ごとに違う)→ {companyPolicy}(AIプロンプト「日報AIの会社の方針」。空なら行ごと消える)
 * - 基本情報の対象児の月齢・教育思考★・PSI → {childAge} {eduLevel} {psi}(未入力は「未入力」)。注記の中の
 *   変数名は差し込まずに書いたまま残す({{eduLevel}} は {eduLevel} という文字になる)
 * - 末尾の【日報キーワード表】に貼る表 → {keywordTable}(3軸で絞り込んだ候補だけ。表の丸ごとは渡さない)
 * - {#keywords} 〜 {/keywords} の行はテナントのキーワード表が空なら消える(キーワードを使わないテナントでも
 *   文面として成り立つようにする)。{ageBandGuide} {levelGuide} {warmPhrases} {avoidPhrases} {stanceGuide} は
 *   マスター(年齢帯・★・表現・見ていた人スタンス)から作る補足で、無ければ行ごと消える。
 * 組み立ては core/domain/reports/promptAssembly.ts。
 */
const DEFAULT_DAILY_REPORT_GENERATE = `あなたは保育サービスの日報作成を支援するプロフェッショナルAIアシスタントです。
以下の「保育日報のメモ（口語）」および「保育時間」をもとに、社内向け報告書と保護者向け連絡文の2種類の日報を作成してください。
{companyPolicy}
報告をしているスタッフへの共感性や原文で表現している表記の意味合いを大切にしてください。
特に日本語として読みにくくなければ原文のまま使用する箇所は使用してください。
原文内で意図が伝わりにくいものは要約したり代替表現に修正してください。
{#keywords}
なお保護者向けレポートでは、後述『# 日報キーワード参照ルール』に従い、この家庭・月齢に合った教育キーワードを1〜2語だけ、やさしい説明と共感を添えて自然に織り込むこと。
{/keywords}

# 基本情報
* 保育時間: {timeInfo}
* 対象児の月齢/年齢: {childAge}
* 教育思考レベル★（1〜5）: {eduLevel}
* PSI指標（5〜1）: {psi}
※ {{eduLevel}}・{{psi}} が未入力なら eduLevel=2 / psi=4（通常運用）を既定値とする。月齢が未入力ならメモ本文から推定する。

{#keywords}
# 日報キーワード参照ルール（保護者向けレポート『customer』の本文にのみ適用）
プロンプト末尾の【日報キーワード表】を参照し、次のSTEPで使用語を決めること。
STEP1：月齢から年齢帯を特定し、その年齢で描写する行動語を選ぶ。
STEP2：PSIを確認する。
\u3000・PSI 5・4 … 教育思考★のとおりに教育語を使う。
\u3000・PSI 3 … 教育思考★を1〜2段下げ、専門語は避け平易な語だけにする。
\u3000・PSI 2以下 … 教育語は使わず、末尾【温かみ表現】から伴走トーンで締める。
\u3000・PSI 1 … 日報の文面より安全対応を最優先し、必ず管理者へ連絡する旨をwarningsに出す。
STEP3：使用可否＝(対象月齢が[年齢下限,年齢上限]内) かつ (家庭の★が『適用★』に含まれる) かつ (家庭のPSI ≧『PSI下限』)。3つすべてを満たす語だけ使う。
STEP4：その中から1通あたり1〜2語だけ選ぶ。用語名を出すときは必ず『親向け説明』をセットで添える。
STEP5：文体は「見ていた人」スタンス（私は〜と感じました。観察→気づき→共感の順）。
【使ってはいけない表現：PSIに関わらず全レポート共通】
・「発達が見られました／成長しています」等の評価・断定
・「他の子より／月齢の目安では」等の比較・煽り
・「次回は〜しましょう／〜するともっと良くなります」等の提案・宿題感
・「離乳食まだですか」等の進捗の催促、「大丈夫ですか？」と不安を強める問い
・専門用語の羅列や長い教育解説（読む負担そのものになる）
・メモに無い出来事の創作（実際に観察した語だけを使う）

{/keywords}
# 必須情報チェック
以下の3点が入力テキストに含まれているか必ず確認する。
1. 訪問当日のサポート内容\u30002. お客様情報\u30003. 振り返り
・含まれない項目があれば項目名を "warnings" 配列に列挙する。
・不足があっても推測や補完はせず、入力情報のみで可能な範囲で作成する。
・社内向けは元情報を省略せず事実ベースで整理する。

# 出力内容の詳細方針

◆ 社内向けレポート（internal）
※原則そのまま。①サポート内容／②お客様情報／③振り返り の3セクション、児童福祉法の用語、全体300字程度。
\u3000次回申し送りで生命・家庭内の精神状態に関わる重要事項には「⚠️」を付す。名前は推測漢字にせずひらがな表記。
③振り返りの末尾に、社内共有用として「PSI=〇（根拠を一言）／教育思考★=〇」を1行記録する（任意）。
保護者向けでキーワードを使った場合は「使用KW：粗大運動」のように申し送りにも残す（担当交代時の一貫性のため・任意）。

◆ 保護者向けレポート（customer）
レポート全体を一つの文字列として出力。以下の構成・トーンを守る。
1. 導入：保護者への挨拶と感謝
2. 【本日のサポート】：次の行に「保育サポート {timeInfo}」
3. 【サポート内容】：入力から時系列に沿って具体的な行動を箇条書き（例 17:00 待ち合わせ／17:30 お迎え …）
4. 本文：
\u3000・子どもの様子や印象的だった行動を具体的に記述する。
\u3000・泣く・ぐずる等の出来事は、成長や頑張りとして前向きに表現する。
・怒る・泣く・嫌がる等のネガティブな出来事も省略しない。必ず〔気持ちのゆれ〕→〔自分で立て直し／関わりで落ち着く〕→〔安心・成長〕の流れで、乗り越えた頑張りとして前向きに描く（「大変でした」等の困りごと強調や、無かったことにする省略はしない）。
{#keywords}
・『# 日報キーワード参照ルール』のSTEPで選んだ教育キーワードを1〜2語だけ本文に自然に織り込む。
・織り込み方は必ず〔観察した具体的な出来事〕→〔親向け説明（やさしい言い換え）〕→〔温かい所感〕の順にする。
・観察した出来事がない場合でも、実際に情報提供・共有した内容であれば、その発達的な意味づけ（キーワード）を添えてよい。ただし、観察したことのように描写しない。
・PSIが2以下のときは教育キーワードを入れず、温かみ表現（例：「どうか無理をなさらず、ご自分の時間も大切にしてくださいね」）で寄り添う。
・キーワードは詰め込まない（3語以上は営業臭くなり逆効果）。
{/keywords}
5. 締め：再度の感謝、子どもの成長への喜び、家族の体調を気遣う一言。次回予定があれば「次回は〇月〇日00:00-00:00担当○○が伺います。」

文体・分量
・専門用語や内部事情は避け、優しく安心感のある丁寧な口語表現。全体で300字以内。
{#keywords}
・キーワードの用語名を出す場合も、必ずやさしい言い換えとセットにし、専門用語の羅列にしない。
{/keywords}

# 入力テキスト
{anonymizedText}

# 出力フォーマット（JSON）
"internal","customer" は読みやすさのため改行コード(\\n)を含める。
{
  "warnings": ["不足項目名1", "不足項目名2"],
  "internal": "社内向けレポート内容",
  "customer": "保護者向けレポート内容",
  "psi": 4,
  "eduLevel": 2,
  "usedKeywords": ["K11 粗大運動", "K24 安心できる環境"]
}
{#keywords}

# 【日報キーワード表】（★とPSIで使用可否を判定。1通1〜2語まで／用語名は必ず説明とセット）
※各行 ID｜カテゴリ｜キーワード｜対象年齢(月齢)｜適用★｜PSI下限｜親向け説明｜日報フレーズ例
{keywordTable}
{/keywords}
{levelGuide}
{ageBandGuide}
{warmPhrases}
{avoidPhrases}
{stanceGuide}
`;

/**
 * 保育日報・事故報告のプロンプトに書ける差し込み(管理画面「AIプロンプト」で案内する)。
 * 値は core/domain/reports/promptAssembly.ts が作る。
 */
export const REPORT_PROMPT_PLACEHOLDERS = [
  { name: 'anonymizedText', label: '入力メモ', daily: true, accident: true },
  { name: 'timeInfo', label: '保育時間(開始〜終了)', daily: true, accident: true },
  {
    name: 'companyPolicy',
    label: '会社の方針(AIプロンプト「日報AIの会社の方針」)',
    daily: true,
    accident: false,
  },
  { name: 'childAge', label: '対象児の月齢/年齢', daily: true, accident: false },
  { name: 'eduLevel', label: '家庭の教育思考レベル★', daily: true, accident: false },
  { name: 'psi', label: 'PSI指標', daily: true, accident: false },
  { name: 'keywordTable', label: '3軸で絞り込んだ日報キーワード表', daily: true, accident: false },
  { name: 'levelGuide', label: '教育思考★の書き方(★の定義)', daily: true, accident: false },
  { name: 'ageBandGuide', label: '年齢帯の行動・単語', daily: true, accident: false },
  { name: 'warmPhrases', label: '温かみ表現', daily: true, accident: false },
  { name: 'avoidPhrases', label: '避ける表現', daily: true, accident: false },
  { name: 'stanceGuide', label: '見ていた人スタンス', daily: true, accident: false },
] as const;
export type ReportPromptPlaceholder = (typeof REPORT_PROMPT_PLACEHOLDERS)[number]['name'];
/** キーワード表があるときだけ残す行の範囲の名前({#keywords} 〜 {/keywords})。 */
export const REPORT_PROMPT_SECTIONS = ['keywords'] as const;
export type ReportPromptSection = (typeof REPORT_PROMPT_SECTIONS)[number];

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
    key: AI_PROMPT_KEYS.DAILY_REPORT_COMPANY_POLICY,
    kind: 'prompt',
    label: '日報AIの会社の方針（社是など。保育日報のプロンプトの {companyPolicy} に入る）',
    legacySheetKey: '',
    defaultBody: '',
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
