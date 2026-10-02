import type { DemoConfigResponse } from '@katahimo/shared';

/**
 * 公開デモの文言(ログイン画面の注意書き・ログイン直後の注釈・画面上の帯・メモ欄の注意)。
 * デモかどうか・保存期間・AI の回数は API(GET /api/demo/config・セッションの `demoTenant`)から決める
 * (本番とデモは同じビルドのため、ビルドの設定では分けない)。日数・月数・回数は必ず API の値を渡す。
 * 日数・月数が null(本番の環境に暫定で置いたデモ用テナント・設定を読めなかった)なら期間を書かず、
 * 日数が null なら「毎晩作り直します」とも書かない(守っていないことを約束しない)。
 * デモの制限(パスワードの変更等を断る)は API が掛ける。ここは表示だけ。
 */

/** 文言に入れる API の値(GET /api/demo/config)。 */
export type DemoTermsValues = Pick<
  Extract<DemoConfigResponse, { enabled: true }>,
  'dataRetentionDays' | 'logRetentionMonths' | 'aiUsesPerSession'
>;

/** 設定が読めない(失敗・デモではない)ときは null(期間を約束しない言い方にする。毎晩の作り直しも書かない)。 */
export function demoTermsValuesOf(config: DemoConfigResponse | undefined): DemoTermsValues | null {
  return config?.enabled ? config : null;
}

/**
 * 訪問者の入力を残す日数。null = 期間を約束しない(本番の環境に暫定で置いたデモ用テナント = 毎晩の作り直しも無い、
 * または設定を読めなかった)。毎晩作り直すと書くのは、この日数があるときだけ(作り直しのジョブがある環境)。
 */
function dataDays(values: DemoTermsValues | null): number | null {
  return values?.dataRetentionDays ?? null;
}

/** 操作ログ・接続情報を残す月数。null = 期間を約束しない。 */
function logMonths(values: DemoTermsValues | null): number | null {
  return values?.logRetentionMonths ?? null;
}

/** 「操作ログ・接続情報（IPアドレス等。◯か月間）」。月数が無ければ期間を書かない。 */
function logAndConnection(values: DemoTermsValues | null): string {
  const months = logMonths(values);
  return months === null
    ? '操作ログ・接続情報（IPアドレス等）'
    : `操作ログ・接続情報（IPアドレス等。${months}か月間）`;
}

/** 保存したものの使い道(注意書き・注釈で共通)。 */
const DEMO_DATA_PURPOSE = 'サービスの改善と不正利用の調査に使います。';

/** 実在の人の情報を入れないようにというお願い(注意書き・注釈・メモ欄で共通)。 */
export const DEMO_NO_REAL_PERSON = '実在の人物の名前・連絡先は入力しないでください';

/** ログイン画面の注意書き(ログインの前に出す。ログインでも IPアドレス等を記録するため)。1要素 = 1行。 */
export function demoLoginNoticeLines(values: DemoTermsValues | null): string[] {
  const days = dataDays(values);
  const data = days === null ? '入力した内容' : `入力した内容（${days}日間）`;
  return [
    'これは公開デモです。お客様・スタッフなどのデータはすべて架空のものです。',
    `${data}と、${logAndConnection(values)}を保存し、${DEMO_DATA_PURPOSE}`,
    `${DEMO_NO_REAL_PERSON}。ログインすると、これらに同意したものとします。`,
  ];
}

/** ログイン直後の注釈の見出し。 */
export const DEMO_TERMS_TITLE = 'デモ環境をお使いになる前に';

/** ログイン直後の注釈の「同意して始める」。 */
export const DEMO_TERMS_AGREE = '同意して始める';

/** ログイン直後の注釈の、同意せずにログアウトするボタン。 */
export const DEMO_TERMS_DECLINE = '同意しない（ログアウト）';

/** 画面上の帯から開き直したときのボタン。 */
export const DEMO_TERMS_CLOSE = '閉じる';

/** デモではできない操作(API が断る。注釈に並べる)。 */
export const DEMO_UNAVAILABLE_OPERATIONS: readonly string[] = [
  'パスワードの変更・再設定',
  '共有のデモ用アカウントの変更・削除',
  'スタッフのExcelの取込・パスワード設定の案内のメール',
  '日報AIの調整（日報の言葉の表）のExcelの取込',
  'お客様の情報の取込（CSV）',
  'Google Chat の通知先の保存',
  '操作ログの閲覧',
];

export interface DemoTermsSection {
  heading: string;
  /** 1要素 = 1段落(箇条書きは items) */
  paragraphs: string[];
  items?: readonly string[];
}

/** 「入力した内容・接続情報の保存」の段落(毎晩作り直すと書くのは日数があるときだけ)。 */
function storageParagraphs(values: DemoTermsValues | null): string[] {
  const days = dataDays(values);
  if (days === null) {
    return [
      'データは架空のものです。',
      `入力した内容と、${logAndConnection(values)}は運営者が保存し、${DEMO_DATA_PURPOSE}`,
    ];
  }
  const months = logMonths(values);
  return [
    'データは架空のもので、毎晩作り直します。',
    months === null
      ? `作り直したあとも、入力した内容は運営者が${days}日間保存し、操作ログ・接続情報（IPアドレス等）も保存して、${DEMO_DATA_PURPOSE}`
      : `作り直したあとも、入力した内容は運営者が${days}日間、操作ログ・接続情報（IPアドレス等）は${months}か月間保存し、${DEMO_DATA_PURPOSE}`,
  ];
}

/** ログイン直後の注釈(画面上の帯からも開ける)。 */
export function demoTermsSections(values: DemoTermsValues | null): DemoTermsSection[] {
  const rebuiltNightly = dataDays(values) !== null;
  return [
    {
      heading: '共有のアカウントです',
      paragraphs: [
        rebuiltNightly
          ? 'デモ用アカウントはほかの閲覧者と共有しています。その日に入力した内容は、ほかの閲覧者にも見えます。'
          : 'デモ用アカウントはほかの閲覧者と共有しています。入力した内容は、ほかの閲覧者にも見えます。',
      ],
    },
    {
      heading: '入力した内容・接続情報の保存',
      paragraphs: storageParagraphs(values),
    },
    {
      heading: 'デモではできない操作',
      paragraphs: [],
      items: DEMO_UNAVAILABLE_OPERATIONS,
    },
    {
      heading: 'AI について',
      paragraphs: [
        '日報・事故報告をAIに書いてもらうと、今日の出来事メモの内容を Google Gemini に送ります。',
        values
          ? `AIを使えるのは、1回のログインにつき${values.aiUsesPerSession}回までです。`
          : 'AIを使える回数には、1回のログインごとの上限があります。',
      ],
    },
    {
      heading: 'お願い',
      paragraphs: [`${DEMO_NO_REAL_PERSON}。`],
    },
  ];
}

/** 画面上の「デモ環境」の帯(押すと注釈を開き直す)。毎晩作り直すと書くのは日数があるときだけ。 */
export function demoBannerText(values: DemoTermsValues | null): string {
  return dataDays(values) === null
    ? 'デモ環境です。データは架空のものです。入力した内容は保存され、ほかの閲覧者にも見えます。'
    : 'デモ環境です。データは架空のもので、毎晩作り直します。入力した内容は保存され、ほかの閲覧者にも見えます。';
}

/** 帯の中の、注釈を開き直すリンクの文言。 */
export const DEMO_BANNER_LINK = '注意事項を見る';
