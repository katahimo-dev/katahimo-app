import type { DemoConfigResponse } from '@katahimo/shared';

/**
 * 公開デモの文言(ログイン画面の注意書き・ログイン直後の注釈・画面上の帯・メモ欄の注意)。
 * デモかどうか・保存期間・AI の回数は API(GET /api/demo/config・セッションの `demoTenant`)から決める
 * (本番とデモは同じビルドのため、ビルドの設定では分けない)。日数・月数・回数は必ず API の値を渡す。
 * デモの制限(パスワードの変更等を断る)は API が掛ける。ここは表示だけ。
 */

/** 文言に入れる API の値(GET /api/demo/config)。 */
export type DemoTermsValues = Pick<
  Extract<DemoConfigResponse, { enabled: true }>,
  'dataRetentionDays' | 'logRetentionMonths' | 'aiUsesPerSession'
>;

/** 設定が読めない(失敗・デモではない)ときは null(文言は「一定期間」等の言い方にする)。 */
export function demoTermsValuesOf(config: DemoConfigResponse | undefined): DemoTermsValues | null {
  return config?.enabled ? config : null;
}

function dataPeriod(values: DemoTermsValues | null): string {
  return values ? `${values.dataRetentionDays}日間` : '一定期間';
}

function logPeriod(values: DemoTermsValues | null): string {
  return values ? `${values.logRetentionMonths}か月間` : '一定期間';
}

/** 実在の人の情報を入れないようにというお願い(注意書き・注釈・メモ欄で共通)。 */
export const DEMO_NO_REAL_PERSON = '実在の人物の名前・連絡先は入力しないでください';

/** ログイン画面の注意書き(ログインの前に出す。ログインでも IPアドレス等を記録するため)。1要素 = 1行。 */
export function demoLoginNoticeLines(values: DemoTermsValues | null): string[] {
  return [
    'これは公開デモです。お客様・スタッフなどのデータはすべて架空のものです。',
    `入力した内容（${dataPeriod(values)}）と、操作ログ・接続情報（IPアドレス等。${logPeriod(values)}）を保存し、サービスの改善と不正利用の調査に使います。`,
    `${DEMO_NO_REAL_PERSON}。ログインすると、これらに同意したものとします。`,
  ];
}

/** ログイン直後の注釈の見出し。 */
export const DEMO_TERMS_TITLE = 'デモ環境をお使いになる前に';

/** ログイン直後の注釈の「同意して始める」。 */
export const DEMO_TERMS_AGREE = '同意して始める';

/** 画面上の帯から開き直したときのボタン。 */
export const DEMO_TERMS_CLOSE = '閉じる';

/** デモではできない操作(API が断る。注釈に並べる)。 */
export const DEMO_UNAVAILABLE_OPERATIONS: readonly string[] = [
  'パスワードの変更・再設定',
  '共有のデモ用アカウントの変更・削除',
  'スタッフのExcelの取込・パスワード設定の案内のメール',
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

/** ログイン直後の注釈(画面上の帯からも開ける)。 */
export function demoTermsSections(values: DemoTermsValues | null): DemoTermsSection[] {
  return [
    {
      heading: '共有のアカウントです',
      paragraphs: [
        'デモ用アカウントはほかの閲覧者と共有しています。その日に入力した内容は、ほかの閲覧者にも見えます。',
      ],
    },
    {
      heading: '入力した内容・接続情報の保存',
      paragraphs: [
        'データは架空のもので、毎晩作り直します。',
        `作り直したあとも、入力した内容は運営者が${dataPeriod(values)}、操作ログ・接続情報（IPアドレス等）は${logPeriod(values)}保存し、サービスの改善と不正利用の調査に使います。`,
      ],
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

/** 画面上の「デモ環境」の帯(押すと注釈を開き直す)。 */
export const DEMO_BANNER_TEXT =
  'デモ環境です。データは架空のもので、毎晩作り直します。入力した内容は保存され、ほかの閲覧者にも見えます。';

/** 帯の中の、注釈を開き直すリンクの文言。 */
export const DEMO_BANNER_LINK = '注意事項を見る';
